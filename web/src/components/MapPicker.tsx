import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Coordinates } from "../geocoding";

type MapPickerProps = {
  target: "pickup" | "destination";
  pickupCoordinates: Coordinates | null;
  destinationCoordinates: Coordinates | null;
  onSelect: (coordinates: Coordinates) => void;
};

export default function MapPicker({
  target, pickupCoordinates, destinationCoordinates, onSelect,
}: MapPickerProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pickupMarkerRef = useRef<L.CircleMarker | null>(null);
  const destinationMarkerRef = useRef<L.CircleMarker | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    if (!elementRef.current) return;
    const map = L.map(elementRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true,
    }).setView([28.5355, 77.3910], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.on("click", event => {
      onSelectRef.current({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      });
    });
    mapRef.current = map;
    const resize = () => map.invalidateSize();
    window.requestAnimationFrame(resize);
    return () => {
      pickupMarkerRef.current = null;
      destinationMarkerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const syncMarker = (
      existing: L.CircleMarker | null,
      coordinates: Coordinates | null,
      label: string,
      color: string,
    ) => {
      if (!coordinates) {
        if (existing) map.removeLayer(existing);
        return null;
      }
      const point = L.latLng(coordinates.latitude, coordinates.longitude);
      if (!existing) {
        return L.circleMarker(point, {
          radius: 8, color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 1,
        }).bindTooltip(label).addTo(map);
      }
      existing.setLatLng(point);
      existing.setTooltipContent(label);
      return existing;
    };
    pickupMarkerRef.current = syncMarker(pickupMarkerRef.current, pickupCoordinates, "Pickup", "#e8821b");
    destinationMarkerRef.current = syncMarker(destinationMarkerRef.current, destinationCoordinates, "Destination", "#0f6e3a");
    const points = [pickupCoordinates, destinationCoordinates].filter((value): value is Coordinates => value !== null);
    if (points.length === 1) map.setView([points[0].latitude, points[0].longitude], 14);
    if (points.length === 2) {
      map.fitBounds(L.latLngBounds(points.map(point => L.latLng(point.latitude, point.longitude))), { padding: [28, 28], maxZoom: 15 });
    }
  }, [pickupCoordinates, destinationCoordinates]);

  return (
    <div className="map-picker-shell">
      <div className="map-picker-canvas" ref={elementRef}
        role="application"
        aria-label={`Noida map. Tap to choose the ${target} location. Existing pickup and destination markers are shown.`} />
      <p className="map-picker-hint">Tap the map to set the {target === "pickup" ? "pickup" : "drop-off"}. You can drag the map and zoom. Use public landmarks only in this preview.</p>
    </div>
  );
}
