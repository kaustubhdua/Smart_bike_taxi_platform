FROM node:22-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Defaults support local evaluation only. compose.production.yaml requires explicit provider URLs.
ARG VITE_API_BASE_URL=http://localhost:8080
ARG VITE_GEOCODING_BASE_URL=https://nominatim.openstreetmap.org/search
ARG VITE_ROUTING_BASE_URL=https://router.project-osrm.org/route/v1/driving
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_GEOCODING_BASE_URL=${VITE_GEOCODING_BASE_URL}
ENV VITE_ROUTING_BASE_URL=${VITE_ROUTING_BASE_URL}
RUN npm run build

FROM nginx:1.30.6-alpine3.24 AS runtime
RUN apk upgrade --no-cache
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
