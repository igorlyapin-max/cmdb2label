# AsyncAPI применимость

Status: not applicable.

`cmdb2label` has no Kafka, RabbitMQ, or equivalent asynchronous broker exchange in the current architecture. The service handles HTTP requests synchronously and calls CMDBuild REST synchronously.

Evidence from repo inspection:

- no Kafka/RabbitMQ dependencies in `package.json`;
- no broker consumers, producers, topics, or queues in `src/`;
- no compose/K8s broker services in deployment templates.

If broker-based exchange is added later, create `aa/asyncapi.yaml` and align topic/queue names with `aa/information-model.md`.
