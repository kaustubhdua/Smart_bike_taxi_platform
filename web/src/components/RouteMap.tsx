import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type RouteMapProps = {
  geometry: Array<[number, number]> | null;
  pickup: string;
  destination: string;
};

export default function RouteMap({ geometry, pickup, destination }: RouteMapProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!elementRef.current || !geometry || geometry.length < 2) return;
    const points = geometry.map(([longitude, latitude]) => L.latLng(latitude, longitude));
    const map = L.map(elementRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const route = L.polyline(points, { color: "#335cff", weight: 5, opacity: 0.95 }).addTo(map);
    const start = L.circleMarker(points[0], {
      radius: 7, color: "#17211d", weight: 2, fillColor: "#b9f65b", fillOpacity: 1,
    }).bindTooltip(`Pickup: ${pickup}`).addTo(map);
    const end = L.circleMarker(points[points.length - 1], {
      radius: 7, color: "#ffffff", weight: 2, fillColor: "#335cff", fillOpacity: 1,
    }).bindTooltip(`Destination: ${destination}`).addTo(map);
    map.fitBounds(route.getBounds(), { padding: [28, 28], maxZoom: 15 });
    start.openTooltip();
    map.invalidateSize();
    return () => map.remove();
  }, [geometry, pickup, destination]);

  if (!geometry || geometry.length < 2) {
    return <div className="route-map-empty" role="status">A real road route will appear here when routing succeeds.</div>;
  }

  return <div ref={elementRef} className="route-map-canvas" role="application"
    aria-label={`Interactive road map from ${pickup} to ${destination}. Use map controls to zoom and drag to pan.`} />;
}
