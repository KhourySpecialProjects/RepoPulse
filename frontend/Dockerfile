FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev

# Local development: `docker-compose.yml` builds this stage (`target: dev`) and
# bind-mounts ./frontend over /app for hot reload. Vite's dev-server proxy
# forwards /api to the backend.
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM deps AS build
COPY . .
# Vite inlines VITE_* variables at build time, so they must be build args;
# setting them as container environment variables has no effect on the bundle.
ARG VITE_PHOENIX_URL
ENV VITE_PHOENIX_URL=$VITE_PHOENIX_URL
RUN npm run build

# Deployment (default target): static bundle served by nginx, which also
# proxies /api to the backend — see nginx.conf.
FROM nginx:alpine
RUN apk upgrade --no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
