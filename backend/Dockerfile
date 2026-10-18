FROM ubuntu:24.04 AS build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates cmake g++ make libboost-dev libcurl4-openssl-dev libpq-dev libssl-dev nlohmann-json3-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN cmake -S . -B /build -DCMAKE_BUILD_TYPE=Release && cmake --build /build --target rideforge_api rideforge_admin_bootstrap --parallel

FROM ubuntu:24.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libcurl4 libpq5 libssl3 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home rideforge
COPY --from=build /build/rideforge_api /usr/local/bin/rideforge_api
COPY --from=build /build/rideforge_admin_bootstrap /usr/local/bin/rideforge_admin_bootstrap
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/rideforge_api"]
