/* test helper (no iproute2 needed):  mkveth <a> <b>   |   mkveth up <if>...   |   mkveth state <if> */
#define _GNU_SOURCE
#include <linux/if_link.h>
#include <linux/rtnetlink.h>
#include <net/if.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <unistd.h>
struct req { struct nlmsghdr n; struct ifinfomsg i; char buf[512]; };
static struct rtattr *nest(struct req *r, int t){ struct rtattr *a=(void*)((char*)r+NLMSG_ALIGN(r->n.nlmsg_len)); a->rta_type=t; a->rta_len=RTA_LENGTH(0); r->n.nlmsg_len=NLMSG_ALIGN(r->n.nlmsg_len)+a->rta_len; return a; }
static void endn(struct req *r, struct rtattr *a){ a->rta_len=(char*)r+r->n.nlmsg_len-(char*)a; }
static void put(struct req *r,int t,const void*d,int l){ struct rtattr *a=(void*)((char*)r+NLMSG_ALIGN(r->n.nlmsg_len)); a->rta_type=t; a->rta_len=RTA_LENGTH(l); memcpy(RTA_DATA(a),d,l); r->n.nlmsg_len=NLMSG_ALIGN(r->n.nlmsg_len)+RTA_ALIGN(a->rta_len); }
static int setflag(const char*n,int up){ struct ifreq f; int s=socket(AF_INET,SOCK_DGRAM,0); memset(&f,0,sizeof f); strncpy(f.ifr_name,n,15); if(ioctl(s,SIOCGIFFLAGS,&f)) return 1; if(up) f.ifr_flags|=IFF_UP; else f.ifr_flags&=~IFF_UP; return ioctl(s,SIOCSIFFLAGS,&f); }
int main(int c,char**v){
  if(c>=3&&!strcmp(v[1],"up")){ for(int i=2;i<c;i++) if(setflag(v[i],1)) perror(v[i]); return 0; }
  if(c==3&&!strcmp(v[1],"state")){ struct ifreq f; int s=socket(AF_INET,SOCK_DGRAM,0); memset(&f,0,sizeof f); strncpy(f.ifr_name,v[2],15); ioctl(s,SIOCGIFFLAGS,&f); printf("%s %s\n",v[2],(f.ifr_flags&IFF_UP)?"UP":"DOWN"); return 0; }
  if(c!=3) return 2;
  struct req r; memset(&r,0,sizeof r);
  r.n.nlmsg_len=NLMSG_LENGTH(sizeof(struct ifinfomsg)); r.n.nlmsg_type=RTM_NEWLINK; r.n.nlmsg_flags=NLM_F_REQUEST|NLM_F_CREATE|NLM_F_EXCL|NLM_F_ACK; r.i.ifi_family=AF_UNSPEC;
  put(&r,IFLA_IFNAME,v[1],strlen(v[1])+1);
  struct rtattr *li=nest(&r,IFLA_LINKINFO); put(&r,IFLA_INFO_KIND,"veth",5);
  struct rtattr *d=nest(&r,IFLA_INFO_DATA); struct rtattr *p=nest(&r,1 /*VETH_INFO_PEER*/);
  r.n.nlmsg_len+=sizeof(struct ifinfomsg); /* peer ifinfomsg, zeroed */
  put(&r,IFLA_IFNAME,v[2],strlen(v[2])+1);
  endn(&r,p); endn(&r,d); endn(&r,li);
  int s=socket(AF_NETLINK,SOCK_RAW,NETLINK_ROUTE); if(send(s,&r,r.n.nlmsg_len,0)<0){perror("send");return 1;}
  char b[1024]; int n=recv(s,b,sizeof b,0); struct nlmsghdr*h=(void*)b; if(n>0&&h->nlmsg_type==NLMSG_ERROR){ int e=((struct nlmsgerr*)NLMSG_DATA(h))->error; if(e){fprintf(stderr,"veth: %s\n",strerror(-e));return 1;} }
  return 0; }
