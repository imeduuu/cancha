# @cancha/api

API NestJS 12 de Cancha sobre `@cancha/core` compilado. Documentación: sección [API](../../README.md#api) del README de la raíz.

```bash
cp .env.example .env
npm run dev:api        # desde la raíz: compila core y arranca en modo watch
npm test -w @cancha/api
```

Imagen Docker: `apps/api/Dockerfile` (contexto = raíz). Prueba local con `docker compose --profile api up -d --build --wait` y `curl http://localhost:3000/health`; ver [API en contenedor](../../README.md#api-en-contenedor).
