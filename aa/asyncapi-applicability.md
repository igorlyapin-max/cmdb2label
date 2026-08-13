# AsyncAPI применимость

Статус: неприменимо.

В текущей архитектуре `cmdb2label` не использует Kafka, RabbitMQ или эквивалентный asynchronous broker exchange. Сервис обрабатывает HTTP requests синхронно и синхронно вызывает CMDBuild REST.

Свидетельства из проверки репозитория:

- нет Kafka/RabbitMQ dependencies в `package.json`;
- нет broker consumers, producers, topics или queues в `src/`;
- нет broker services в compose/K8s deployment templates.

Если позже появится broker-based exchange, нужно создать `aa/asyncapi.yaml` и согласовать topic/queue names с `aa/information-model.md`.
