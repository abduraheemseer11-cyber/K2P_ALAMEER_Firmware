#!/usr/bin/env python3
"""regdb-has-country.py <regulatory.db | wireless-regdb*.ipk> <CC>   exit 0 = country present

regulatory.db layout (net/wireless/regdb.h): be32 magic 'RGDB', be32 version, then 4-byte country
records {alpha2[2], be16 coll_ptr} terminated by coll_ptr == 0.  If the list cannot be parsed
(unknown layout) the check falls back to a plain byte search and says so."""
import io, struct, sys, tarfile

path, cc = sys.argv[1], sys.argv[2].encode()
data = open(path, "rb").read()
if path.endswith(".ipk"):                       # ipk = ar archive -> data.tar.gz -> lib/firmware/regulatory.db
    outer = tarfile.open(fileobj=io.BytesIO(data)) if data[:2] == b"\x1f\x8b" else None
    if outer is None:
        sys.exit("ipk is not a gzip tar")
    inner = outer.extractfile("./data.tar.gz").read()
    data = tarfile.open(fileobj=io.BytesIO(inner)).extractfile("./lib/firmware/regulatory.db").read()
if data[:4] != b"RGDB":
    sys.exit("not a regulatory.db (bad magic)")
countries, off = [], 8
while off + 4 <= len(data):
    a2, ptr = data[off:off + 2], struct.unpack(">H", data[off + 2:off + 4])[0]
    if ptr == 0: break
    countries.append(a2); off += 4
print("countries parsed: %d" % len(countries))
if b"US" in countries:
    ok = cc in countries
    print("%s %s" % (cc.decode(), "PRESENT" if ok else "MISSING")); sys.exit(0 if ok else 1)
ok = cc in data
print("layout not recognised -> raw byte search: %s %s" % (cc.decode(), "found" if ok else "NOT found")); sys.exit(0 if ok else 1)
