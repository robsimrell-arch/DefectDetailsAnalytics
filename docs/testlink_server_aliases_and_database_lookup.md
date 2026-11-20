# TestLink Database Names and Server Aliases

Clients should connect to TestLink servers using the designated DNS alias rather than hardcoded IP addresses or physical machine hostnames. Communication is conducted over **TCP Port 50000** using **TLS 1.2**.

| Site | PFS Database (`DATABASE`) | Server DNS Alias |
| :--- | :--- | :--- |
| Almelo | `PFSALP4` | `pfs-gw-alp4.corp.bench.com` |
| Angleton | `PFSTXP4` | `pfs-gw-txp4.corp.bench.com` |
| Austin | `PFSATP4` | `pfs-gw-atp4.corp.bench.com` |
| Ayuthaya | `PFSTHP4` | `pfs-gw-thp4.corp.bench.com` |
| Brasov | `PFSROP4` | `pfs-gw-rop4.corp.bench.com` |
| Dunseith | `PFSDNP4` | `pfs-gw-dnp4.corp.bench.com` |
| Guadalajara | `PFSMXP4` | `pfs-gw-mxp4.corp.bench.com` |
| Huntsville | `PFSHSP4` | `pfs-gw-hsp4.corp.bench.com` |
| Scottsdale AZ IoT Group | `PFSSZP4` | `pfs-gw-szp4.corp.bench.com` |
| Moorpark | `PFSMPP4` | `pfs-gw-mpp4.corp.bench.com` |
| Nashua | `PFSHDP4` | `pfs-gw-hdp4.corp.bench.com` |
| Penang | `PFSMYP4` | `pfs-gw-myp4.corp.bench.com` |
| Phoenix | `PFSPHP4` | `pfs-gw-php4.corp.bench.com` |
| Precision Technologies | `PFSPTP4` | `pfs-gw-ptp4.corp.bench.com` |
| Rochester | `PFSMNP4` | `pfs-gw-mnp4.corp.bench.com` |
| San Jose | `PFSSJP4` | `pfs-gw-sjp4.corp.bench.com` |
| Santa Anna | `PFSSAP4` | `pfs-gw-sap4.corp.bench.com` |
| Suzhou | `PFSCHP4` | `pfs-gw-chp4.corp.bench.com` |
| Tijuana | `PFSTIP4` | `pfs-gw-tip4.corp.bench.com` |
| Tijuana (Filtros) | `PFSFLP4` | `pfs-gw-flp4.corp.bench.com` |
| Winona | `PFSMNP4` | `pfs-gw-mnp4.corp.bench.com` |

---

## TLS / Certificate Configuration Notes

* **Port:** `50000`
* **Protocol:** TLS 1.2
* **Client Authentication:** Not required (client does not present a client certificate).
* **Server Authentication:** Optional for the client.
  * Server certificate hostname: `testlink.bench.com`
  * Root CA: `ca.corp.bench.com` (TestLinkRootCA certificate must be imported into the local machine's `Trusted Root Certification Authorities` store if validating).