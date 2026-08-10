# Customer CA для Docker build

Этот каталог является видимым contract местом для customer CA, который нужно встроить в image trust store. Dockerfile копирует этот каталог сразу после `FROM`, до первого `apt-get update`, поэтому сертификат может использоваться для corporate apt proxy или private OS repositories во время build.

Реальные сертификаты заказчика не коммитятся в git. Перед embedded build положите сюда CA bundle:

```bash
cp /secure/customer/CheckPoint.crt certs/customer-ca/customer-ca.crt
sha256sum certs/customer-ca/customer-ca.crt
docker build \
  --build-arg CMDB_LABELS_EMBED_CUSTOM_CA=required \
  -t ghcr.io/igorlyapin-max/cmdb2label:<version>-customer-ca \
  .
```

Если сертификат нужен только на runtime host, используйте mount mode из `docker-compose.customer-ca.yml` вместо пересборки image.

Не кладите сюда private keys (`*.key`) и PKCS#12 bundles (`*.p12`): приложению нужен только публичный CA certificate или chain в формате `*.crt`/`*.pem`.
