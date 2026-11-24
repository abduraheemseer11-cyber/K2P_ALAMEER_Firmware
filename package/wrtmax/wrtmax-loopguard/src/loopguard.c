/*
 * wrtmax-loopguard - Layer-2 loop detector / port isolator for DSA switch ports
 *
 * How it works
 *   - One AF_PACKET raw socket per monitored port (lan1..lan4, wan).
 *   - Every <interval_ms> a tagged probe frame (EtherType 0x88B5, broadcast
 *     destination, random per-process nonce) is sent out of every port that is up.
 *   - If a probe carrying OUR nonce is received on any port, there is a loop:
 *       same port      -> the far end reflects the frame back
 *       different port -> a cable / switch connects the two ports
 *     Detection latency is the time the frame needs to travel the loop
 *     (microseconds..ms) plus at most one probe interval.
 *   - The offending *downlink* port is put administratively down (IFF_UP off).
 *     Ports with role "uplink" are never shut down; an alert is raised instead.
 *   - A netlink (RTMGRP_LINK) socket wakes the daemon on every link change, so
 *     a port that netifd brings up again while isolated is re-isolated at once.
 *   - Secondary protection: multicast/broadcast storm rate per port (sysfs counters).
 *   - Control socket /var/run/wrtmax-loopguard/ctl.sock:  status | reset <port|all> | reload
 *     State for LuCI: /var/run/wrtmax-loopguard/state.json
 *
 * Usage:  wrtmax-loopguard [-f conf]        run daemon (foreground, for procd)
 *         wrtmax-loopguard -c <command...>  talk to the running daemon
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/if_packet.h>
#include <linux/netlink.h>
#include <linux/rtnetlink.h>
#include <net/if.h>
#include <net/ethernet.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/timerfd.h>
#include <sys/un.h>
#include <syslog.h>
#include <time.h>
#include <unistd.h>

#define ETH_P_WRTMAX 0x88B5
#define MAX_PORTS    8
#define MAX_EVENTS   20
#define PORT_TAG     1000ull   /* epoll tag of port i = PORT_TAG + i ; other fds use their own small fd number */
#define RUN_DIR      "/var/run/wrtmax-loopguard"
#define SOCK_PATH    RUN_DIR "/ctl.sock"
#define STATE_PATH   RUN_DIR "/state.json"
#define DEF_CONF     "/var/etc/wrtmax-loopguard.conf"

struct probe {
	char     magic[8];
	uint64_t nonce;
	uint32_t seq;
	uint16_t port_idx;
	uint16_t pad;
	uint64_t ts_ns;
} __attribute__((packed));

enum role { ROLE_DOWNLINK = 0, ROLE_UPLINK = 1 };

struct port {
	char      name[IFNAMSIZ];
	enum role role;
	int       ifindex;     /* 0 = interface missing */
	int       fd;          /* AF_PACKET socket, -1 if none */
	uint8_t   mac[6];
	int       up;          /* IFF_UP && IFF_LOWER_UP */
	int       isolated;
	time_t    iso_since;
	char      iso_reason[96];
	uint64_t  last_mc;     /* storm counters */
	int       have_mc;
	int       storm_hits;
	uint64_t  tx_probes;
};

struct event { time_t t; char port[IFNAMSIZ]; char msg[160]; };

static struct port ports[MAX_PORTS];
static int nports;
static struct event events[MAX_EVENTS];
static int nevents;                       /* total, ring index = nevents % MAX_EVENTS */
static int enabled = 1, interval_ms = 100, storm_pps = 20000, recover_s = 0;
static uint64_t nonce;
static uint32_t seq;
static int epfd = -1, nlfd = -1, ctlfd = -1, tfd_probe = -1, tfd_tick = -1;
static volatile sig_atomic_t want_exit, want_reload;
static const char *conf_path = DEF_CONF;
static uint64_t loops_detected;
static void add_event(const char *port, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
static time_t alert_t, alert_logged;       /* last alert seen / last alert written to the log */
static char alert_msg[160];

/* alerts (loop on an uplink - not shut down) are shown in the UI continuously but logged at most every 10 s */
static void raise_alert(const char *port, const char *msg)
{
	time_t now = time(NULL);
	alert_t = now;
	snprintf(alert_msg, sizeof(alert_msg), "%s", msg);
	if (now - alert_logged >= 10) {
		alert_logged = now;
		add_event(port, "ALERT (uplink, NOT shut down): %s", msg);
	}
}

static uint64_t now_ns(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (uint64_t)ts.tv_sec * 1000000000ull + ts.tv_nsec;
}

static void add_event(const char *port, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
static void add_event(const char *port, const char *fmt, ...)
{
	struct event *e = &events[nevents % MAX_EVENTS];
	va_list ap;
	e->t = time(NULL);
	snprintf(e->port, sizeof(e->port), "%s", port ? port : "-");
	va_start(ap, fmt);
	vsnprintf(e->msg, sizeof(e->msg), fmt, ap);
	va_end(ap);
	nevents++;
	syslog(LOG_WARNING, "%s: %s", e->port, e->msg);
}

/* ---------------------------------------------------------------- state file */
static void json_str(FILE *f, const char *s)
{
	fputc('"', f);
	for (; *s; s++) {
		unsigned char c = *s;
		if (c == '"' || c == '\\') { fputc('\\', f); fputc(c, f); }
		else if (c < 0x20 || c > 0x7e) fputc('?', f);
		else fputc(c, f);
	}
	fputc('"', f);
}

static void write_state_to(FILE *f)
{
	int i, first = 1, start, cnt;
	fprintf(f, "{\"running\":true,\"enabled\":%s,\"probe_ms\":%d,\"storm_pps\":%d,\"loops\":%llu,\"ports\":[",
		enabled ? "true" : "false", interval_ms, storm_pps, (unsigned long long)loops_detected);
	for (i = 0; i < nports; i++) {
		struct port *p = &ports[i];
		fprintf(f, "%s{\"name\":", i ? "," : "");
		json_str(f, p->name);
		fprintf(f, ",\"role\":\"%s\",\"present\":%s,\"up\":%s,\"isolated\":%s,\"since\":%ld,\"reason\":",
			p->role == ROLE_UPLINK ? "uplink" : "downlink", p->ifindex ? "true" : "false",
			p->up ? "true" : "false", p->isolated ? "true" : "false", (long)(p->isolated ? p->iso_since : 0));
		json_str(f, p->isolated ? p->iso_reason : "");
		fputc('}', f);
	}
	fputs("],\"events\":[", f);
	cnt = nevents < MAX_EVENTS ? nevents : MAX_EVENTS;
	start = nevents - cnt;
	for (i = 0; i < cnt; i++) {
		struct event *e = &events[(start + i) % MAX_EVENTS];
		fprintf(f, "%s{\"t\":%ld,\"port\":", first ? "" : ",", (long)e->t);
		json_str(f, e->port);
		fputs(",\"msg\":", f);
		json_str(f, e->msg);
		fputc('}', f);
		first = 0;
	}
	fputs("]", f);
	if (alert_t && time(NULL) - alert_t <= 30) {
		fprintf(f, ",\"alert\":{\"t\":%ld,\"msg\":", (long)alert_t);
		json_str(f, alert_msg);
		fputc('}', f);
	}
	fputs("}\n", f);
}

static void write_state(void)
{
	char tmp[] = STATE_PATH ".tmp";
	FILE *f = fopen(tmp, "w");
	if (!f) return;
	write_state_to(f);
	fclose(f);
	rename(tmp, STATE_PATH);
}

/* ---------------------------------------------------------------- port helpers */
static int set_link(const char *name, int up)
{
	struct ifreq ifr;
	int s = socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, 0), rc = -1;
	if (s < 0) return -1;
	memset(&ifr, 0, sizeof(ifr));
	snprintf(ifr.ifr_name, sizeof(ifr.ifr_name), "%s", name);
	if (ioctl(s, SIOCGIFFLAGS, &ifr) == 0) {
		if (up) ifr.ifr_flags |= IFF_UP; else ifr.ifr_flags &= ~IFF_UP;
		rc = ioctl(s, SIOCSIFFLAGS, &ifr);
	}
	close(s);
	return rc;
}

static void close_port_socket(struct port *p)
{
	if (p->fd >= 0) {
		epoll_ctl(epfd, EPOLL_CTL_DEL, p->fd, NULL);
		close(p->fd);
		p->fd = -1;
	}
}

static void open_port_socket(struct port *p)
{
	struct sockaddr_ll sll;
	struct epoll_event ev;
	int fd = socket(AF_PACKET, SOCK_RAW | SOCK_CLOEXEC | SOCK_NONBLOCK, htons(ETH_P_WRTMAX));
	if (fd < 0) return;
	memset(&sll, 0, sizeof(sll));
	sll.sll_family = AF_PACKET;
	sll.sll_protocol = htons(ETH_P_WRTMAX);
	sll.sll_ifindex = p->ifindex;
	if (bind(fd, (struct sockaddr *)&sll, sizeof(sll)) < 0) { close(fd); return; }
	p->fd = fd;
	memset(&ev, 0, sizeof(ev));
	ev.events = EPOLLIN;
	ev.data.u64 = PORT_TAG + (uint64_t)(p - ports);
	epoll_ctl(epfd, EPOLL_CTL_ADD, fd, &ev);
}

/* IFF_LOWER_UP does not fit the 16-bit ifr_flags of SIOCGIFFLAGS, so read the carrier from sysfs */
static int read_carrier(const char *name)
{
	char path[128], c = '0';
	FILE *f;
	snprintf(path, sizeof(path), "/sys/class/net/%.15s/carrier", name);
	f = fopen(path, "r");
	if (!f) return 0;               /* administratively down interfaces return EINVAL -> treated as no carrier */
	if (fscanf(f, " %c", &c) != 1) c = '0';
	fclose(f);
	return c == '1';
}

/* re-read ifindex / flags / MAC of one port; (re)open its socket when needed */
static void refresh_port(struct port *p)
{
	struct ifreq ifr;
	int idx = if_nametoindex(p->name), s;
	if (idx != p->ifindex) {
		close_port_socket(p);
		p->ifindex = idx;
		p->up = 0;
		if (idx) syslog(LOG_INFO, "%s: interface appeared (ifindex %d)", p->name, idx);
	}
	if (!idx) { p->up = 0; return; }
	s = socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, 0);
	if (s < 0) return;
	memset(&ifr, 0, sizeof(ifr));
	snprintf(ifr.ifr_name, sizeof(ifr.ifr_name), "%s", p->name);
	if (ioctl(s, SIOCGIFFLAGS, &ifr) == 0) {
		int fl = ifr.ifr_flags;
		p->up = (fl & IFF_UP) && read_carrier(p->name);
		/* an isolated port must stay down, even if netifd raises it again */
		if (p->isolated && (fl & IFF_UP)) {
			set_link(p->name, 0);
			p->up = 0;
			add_event(p->name, "port was re-enabled while isolated - isolated again");
		}
	}
	memset(&ifr, 0, sizeof(ifr));
	snprintf(ifr.ifr_name, sizeof(ifr.ifr_name), "%s", p->name);
	if (ioctl(s, SIOCGIFHWADDR, &ifr) == 0) memcpy(p->mac, ifr.ifr_hwaddr.sa_data, 6);
	close(s);
	if (p->fd < 0 && !p->isolated) open_port_socket(p);
}

static void refresh_all(void)
{
	int i;
	for (i = 0; i < nports; i++) refresh_port(&ports[i]);
}

static void isolate(struct port *p, const char *why)
{
	if (p->isolated) return;
	if (p->role == ROLE_UPLINK) {
		raise_alert(p->name, why);
		return;
	}
	set_link(p->name, 0);
	p->isolated = 1;
	p->iso_since = time(NULL);
	snprintf(p->iso_reason, sizeof(p->iso_reason), "%s", why);
	p->up = 0;
	p->storm_hits = 0;
	close_port_socket(p);
	add_event(p->name, "ISOLATED: %s", why);
}

static void release(struct port *p, const char *how)
{
	if (!p->isolated) return;
	p->isolated = 0;
	p->iso_reason[0] = 0;
	p->storm_hits = 0;
	p->have_mc = 0;
	set_link(p->name, 1);
	add_event(p->name, "port released (%s)", how);
	refresh_port(p);
}

/* ---------------------------------------------------------------- probes */
static void send_probes(void)
{
	int i;
	for (i = 0; i < nports; i++) {
		struct port *p = &ports[i];
		unsigned char frame[sizeof(struct ether_header) + sizeof(struct probe)];
		struct ether_header *eh = (struct ether_header *)frame;
		struct probe *pr = (struct probe *)(frame + sizeof(*eh));
		struct sockaddr_ll sll;
		if (p->fd < 0 || !p->up || p->isolated) continue;
		memset(eh->ether_dhost, 0xff, 6);
		memcpy(eh->ether_shost, p->mac, 6);
		eh->ether_shost[0] |= 0x02;          /* locally administered: never equals br-lan's own MAC */
		eh->ether_shost[5] ^= (uint8_t)(i + 1);
		eh->ether_type = htons(ETH_P_WRTMAX);
		memcpy(pr->magic, "WRTMAXLG", 8);
		pr->nonce = nonce;
		pr->seq = htonl(++seq);
		pr->port_idx = htons((uint16_t)i);
		pr->pad = 0;
		pr->ts_ns = now_ns();
		memset(&sll, 0, sizeof(sll));
		sll.sll_family = AF_PACKET;
		sll.sll_ifindex = p->ifindex;
		sll.sll_halen = 6;
		memset(sll.sll_addr, 0xff, 6);
		if (sendto(p->fd, frame, sizeof(frame), 0, (struct sockaddr *)&sll, sizeof(sll)) > 0) p->tx_probes++;
	}
}

static void on_loop(int src_idx, struct port *rx, unsigned long lat_us)
{
	struct port *src = (src_idx >= 0 && src_idx < nports) ? &ports[src_idx] : NULL;
	struct port *victim = NULL;
	char why[96];
	/* a probe that was already in flight when the loop got broken (one end isolated) is stale */
	if (rx->isolated || (src && src->isolated)) return;
	loops_detected++;
	if (!src || src == rx) {
		snprintf(why, sizeof(why), "loop: probe reflected back on same port (%lu us)", lat_us);
		isolate(rx, why);
	} else {
		if (rx->role == ROLE_DOWNLINK && !rx->isolated) victim = rx;
		else if (src->role == ROLE_DOWNLINK && !src->isolated) victim = src;
		if (victim) {
			snprintf(why, sizeof(why), "loop between %s and %s (%lu us)", src->name, rx->name, lat_us);
			isolate(victim, why);
		} else if (!rx->isolated && !src->isolated) {
			snprintf(why, sizeof(why), "loop between uplinks %s and %s (%lu us) - set one to downlink", src->name, rx->name, lat_us);
			raise_alert(rx->name, why);
		}
	}
	write_state();
}

static void handle_rx(struct port *p)
{
	unsigned char buf[256];
	struct sockaddr_ll from;
	socklen_t fl;
	ssize_t n;
	for (;;) {
		fl = sizeof(from);
		n = recvfrom(p->fd, buf, sizeof(buf), 0, (struct sockaddr *)&from, &fl);
		if (n < 0) break;
		if (from.sll_pkttype == PACKET_OUTGOING) continue;
		if ((size_t)n < sizeof(struct ether_header) + sizeof(struct probe)) continue;
		struct probe *pr = (struct probe *)(buf + sizeof(struct ether_header));
		if (memcmp(pr->magic, "WRTMAXLG", 8) || pr->nonce != nonce) continue;   /* foreign probe: ignore */
		{
			uint64_t t = now_ns();
			unsigned long lat = pr->ts_ns && t > pr->ts_ns ? (unsigned long)((t - pr->ts_ns) / 1000) : 0;
			on_loop(ntohs(pr->port_idx), p, lat);
		}
		if (p->isolated || p->fd < 0) break;
	}
}

/* ---------------------------------------------------------------- storm check (1 Hz) */
static void storm_tick(void)
{
	int i;
	time_t now = time(NULL);
	for (i = 0; i < nports; i++) {
		struct port *p = &ports[i];
		char path[128];
		FILE *f;
		unsigned long long cur;
		if (p->isolated) {
			if (recover_s > 0 && now - p->iso_since >= recover_s) release(p, "auto-recover timer");
			continue;
		}
		if (!p->ifindex || !p->up) { p->have_mc = 0; continue; }
		snprintf(path, sizeof(path), "/sys/class/net/%.15s/statistics/multicast", p->name);
		f = fopen(path, "r");
		if (!f) continue;
		if (fscanf(f, "%llu", &cur) == 1) {
			if (p->have_mc && cur >= p->last_mc && (cur - p->last_mc) > (unsigned long long)storm_pps) {
				if (++p->storm_hits >= 3) {
					char why[96];
					snprintf(why, sizeof(why), "broadcast/multicast storm (%llu pkt/s)", cur - p->last_mc);
					isolate(p, why);
					write_state();
					p->storm_hits = 0;
				}
			} else p->storm_hits = 0;
			p->last_mc = cur;
			p->have_mc = 1;
		}
		fclose(f);
	}
	write_state();
}

/* ---------------------------------------------------------------- config */
static void load_config(void)
{
	FILE *f = fopen(conf_path, "r");
	char line[160], a[64], b[64];
	struct port old[MAX_PORTS];
	int nold = nports, i;
	memcpy(old, ports, sizeof(ports));
	nports = 0;
	enabled = 1; interval_ms = 100; storm_pps = 20000; recover_s = 0;
	if (f) {
		while (fgets(line, sizeof(line), f)) {
			int v;
			if (sscanf(line, "enabled %d", &v) == 1) enabled = v;
			else if (sscanf(line, "interval_ms %d", &v) == 1) interval_ms = v < 20 ? 20 : v > 5000 ? 5000 : v;
			else if (sscanf(line, "storm_pps %d", &v) == 1) storm_pps = v < 100 ? 100 : v;
			else if (sscanf(line, "recover_s %d", &v) == 1) recover_s = v < 0 ? 0 : v;
			else if (sscanf(line, "port %63s %63s", a, b) == 2 && nports < MAX_PORTS) {
				struct port *p = &ports[nports];
				memset(p, 0, sizeof(*p));
				snprintf(p->name, sizeof(p->name), "%.15s", a);
				p->role = strcmp(b, "uplink") == 0 ? ROLE_UPLINK : ROLE_DOWNLINK;
				p->fd = -1;
				for (i = 0; i < nold; i++)           /* keep runtime state of known ports */
					if (!strcmp(old[i].name, a)) {
						p->fd = old[i].fd; p->ifindex = old[i].ifindex; p->isolated = old[i].isolated;
						p->iso_since = old[i].iso_since;
						memcpy(p->iso_reason, old[i].iso_reason, sizeof(p->iso_reason));
						old[i].fd = -2;               /* mark as kept */
						if (p->fd >= 0) {              /* epoll data pointer changed -> re-register */
							struct epoll_event ev = { .events = EPOLLIN, .data.u64 = PORT_TAG + (uint64_t)nports };
							epoll_ctl(epfd, EPOLL_CTL_DEL, p->fd, NULL);
							epoll_ctl(epfd, EPOLL_CTL_ADD, p->fd, &ev);
						}
					}
				nports++;
			}
		}
		fclose(f);
	}
	for (i = 0; i < nold; i++) {                        /* dropped ports: close socket, release if isolated */
		if (old[i].fd == -2) continue;
		if (old[i].fd >= 0) { epoll_ctl(epfd, EPOLL_CTL_DEL, old[i].fd, NULL); close(old[i].fd); }
		if (old[i].isolated) set_link(old[i].name, 1);
	}
	if (tfd_probe >= 0) {
		struct itimerspec its = { { interval_ms / 1000, (interval_ms % 1000) * 1000000L },
					  { interval_ms / 1000, (interval_ms % 1000) * 1000000L } };
		timerfd_settime(tfd_probe, 0, &its, NULL);
	}
	refresh_all();
	write_state();
}

/* ---------------------------------------------------------------- control socket */
static void handle_ctl(void)
{
	int c = accept4(ctlfd, NULL, NULL, SOCK_CLOEXEC);
	char cmd[96] = "", arg[64] = "";
	struct timeval tv = { 0, 200000 };
	ssize_t n;
	FILE *out;
	if (c < 0) return;
	setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
	n = read(c, cmd, sizeof(cmd) - 1);
	if (n <= 0) { close(c); return; }
	cmd[n] = 0;
	sscanf(cmd, "%*s %63s", arg);
	out = fdopen(c, "w");
	if (!out) { close(c); return; }
	if (!strncmp(cmd, "reset", 5)) {
		int i, done = 0;
		for (i = 0; i < nports; i++)
			if ((!strcmp(arg, "all") || !strcmp(arg, ports[i].name)) && ports[i].isolated) { release(&ports[i], "manual reset"); done++; }
		write_state();
		fprintf(out, "{\"ok\":true,\"released\":%d}\n", done);
	} else if (!strncmp(cmd, "reload", 6)) {
		want_reload = 1;
		fputs("{\"ok\":true}\n", out);
	} else {
		write_state_to(out);
	}
	fclose(out);
}

static int client_mode(int argc, char **argv)
{
	struct sockaddr_un sa = { .sun_family = AF_UNIX };
	char buf[4096], cmd[128] = "";
	int s = socket(AF_UNIX, SOCK_STREAM, 0), i;
	ssize_t n;
	if (s < 0) return 2;
	snprintf(sa.sun_path, sizeof(sa.sun_path), "%s", SOCK_PATH);
	if (connect(s, (struct sockaddr *)&sa, sizeof(sa)) < 0) { puts("{\"running\":false}"); return 1; }
	for (i = 0; i < argc; i++) { strncat(cmd, argv[i], sizeof(cmd) - strlen(cmd) - 2); strncat(cmd, " ", sizeof(cmd) - strlen(cmd) - 1); }
	if (write(s, cmd, strlen(cmd)) < 0) return 2;
	shutdown(s, SHUT_WR);
	while ((n = read(s, buf, sizeof(buf))) > 0) fwrite(buf, 1, n, stdout);
	close(s);
	return 0;
}

/* ---------------------------------------------------------------- main */
static void on_sig(int sig)
{
	if (sig == SIGHUP) want_reload = 1; else want_exit = 1;
}

static void setup_ctl(void)
{
	struct sockaddr_un sa = { .sun_family = AF_UNIX };
	struct epoll_event ev = { .events = EPOLLIN };
	mkdir("/var/run", 0755);
	mkdir(RUN_DIR, 0755);
	unlink(SOCK_PATH);
	ctlfd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
	snprintf(sa.sun_path, sizeof(sa.sun_path), "%s", SOCK_PATH);
	if (ctlfd < 0 || bind(ctlfd, (struct sockaddr *)&sa, sizeof(sa)) < 0 || listen(ctlfd, 4) < 0) {
		syslog(LOG_ERR, "control socket failed: %s", strerror(errno));
		return;
	}
	chmod(SOCK_PATH, 0600);
	ev.data.u64 = ctlfd;
	epoll_ctl(epfd, EPOLL_CTL_ADD, ctlfd, &ev);
}

int main(int argc, char **argv)
{
	struct epoll_event evs[16];
	struct epoll_event ev;
	struct sockaddr_nl snl = { .nl_family = AF_NETLINK, .nl_groups = RTMGRP_LINK };
	struct itimerspec tick = { { 1, 0 }, { 1, 0 } };
	int opt, i;
	FILE *ur;

	if (argc > 1 && !strcmp(argv[1], "-c")) return client_mode(argc - 2, argv + 2);
	while ((opt = getopt(argc, argv, "f:")) != -1)
		if (opt == 'f') conf_path = optarg;

	openlog("wrtmax-loopguard", LOG_PID, LOG_DAEMON);
	ur = fopen("/dev/urandom", "r");
	if (!ur || fread(&nonce, sizeof(nonce), 1, ur) != 1) nonce = now_ns() ^ ((uint64_t)getpid() << 32);
	if (ur) fclose(ur);

	signal(SIGTERM, on_sig); signal(SIGINT, on_sig); signal(SIGHUP, on_sig); signal(SIGPIPE, SIG_IGN);
	epfd = epoll_create1(EPOLL_CLOEXEC);
	for (i = 0; i < MAX_PORTS; i++) ports[i].fd = -1;

	tfd_probe = timerfd_create(CLOCK_MONOTONIC, TFD_CLOEXEC | TFD_NONBLOCK);
	tfd_tick = timerfd_create(CLOCK_MONOTONIC, TFD_CLOEXEC | TFD_NONBLOCK);
	timerfd_settime(tfd_tick, 0, &tick, NULL);
	memset(&ev, 0, sizeof(ev)); ev.events = EPOLLIN; ev.data.u64 = tfd_probe; epoll_ctl(epfd, EPOLL_CTL_ADD, tfd_probe, &ev);
	ev.data.u64 = tfd_tick; epoll_ctl(epfd, EPOLL_CTL_ADD, tfd_tick, &ev);

	nlfd = socket(AF_NETLINK, SOCK_RAW | SOCK_CLOEXEC | SOCK_NONBLOCK, NETLINK_ROUTE);
	if (nlfd >= 0 && bind(nlfd, (struct sockaddr *)&snl, sizeof(snl)) == 0) {
		ev.data.u64 = nlfd; epoll_ctl(epfd, EPOLL_CTL_ADD, nlfd, &ev);
	} else syslog(LOG_WARNING, "netlink unavailable - falling back to 1 s polling");

	setup_ctl();
	load_config();
	syslog(LOG_INFO, "started: %d ports, probe every %d ms", nports, interval_ms);

	while (!want_exit) {
		int n = epoll_wait(epfd, evs, 16, 1000), k;
		if (want_reload) { want_reload = 0; load_config(); }
		for (k = 0; k < n; k++) {
			if ((int)evs[k].data.u64 == tfd_probe && evs[k].events & EPOLLIN) {
				uint64_t x; if (read(tfd_probe, &x, sizeof(x)) > 0 && enabled) send_probes();
			} else if ((int)evs[k].data.u64 == tfd_tick) {
				uint64_t x; if (read(tfd_tick, &x, sizeof(x)) > 0) { if (nlfd < 0) refresh_all(); if (enabled) storm_tick(); else write_state(); }
			} else if ((int)evs[k].data.u64 == nlfd) {
				char nb[4096];
				while (recv(nlfd, nb, sizeof(nb), 0) > 0) ;
				refresh_all();                         /* any link event: re-read every port (<=8) */
				write_state();
			} else if ((int)evs[k].data.u64 == ctlfd) {
				handle_ctl();
			} else if (evs[k].data.u64 >= PORT_TAG && enabled) {
				unsigned idx = (unsigned)(evs[k].data.u64 - PORT_TAG);
				if (idx < (unsigned)nports && ports[idx].fd >= 0) handle_rx(&ports[idx]);
			}
		}
	}
	for (i = 0; i < nports; i++)
		if (ports[i].isolated) set_link(ports[i].name, 1);   /* never leave ports dead after a stop */
	unlink(SOCK_PATH);
	syslog(LOG_INFO, "stopped");
	return 0;
}
