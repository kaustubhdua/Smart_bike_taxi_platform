import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Coordinates = { latitude: number; longitude: number };
type RouteMapProps = {
  geometry: Array<[number, number]> | null;
  pickup: string;
  destination: string;
  driverLocation?: { latitude: number; longitude: number; updatedAt: string } | null;
  selectionTarget?: "pickup" | "destination" | null;
  focusCoordinates?: Coordinates | null;
  onSelectCoordinates?: (latitude: number, longitude: number) => void;
};

const DEFAULT_CENTER: L.LatLngExpression = [28.5355, 77.391];

export default function RouteMap({
  geometry,
  pickup,
  destination,
  driverLocation,
  selectionTarget = null,
  focusCoordinates = null,
  onSelectCoordinates,
}: RouteMapProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const driverMarkerRef = useRef<L.CircleMarker | null>(null);
  const [mapVersion, setMapVersion] = useState(0);

  useEffect(() => {
    if (!elementRef.current) return;
    const map = L.map(elementRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true,
      keyboard: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapRef.current = map;

    if (geometry && geometry.length >= 2) {
      const points = geometry.map(([longitude, latitude]) => L.latLng(latitude, longitude));
      const route = L.polyline(points, { color: "#335cff", weight: 5, opacity: 0.95 }).addTo(map);
      L.circleMarker(points[0], {
        radius: 7, color: "#17211d", weight: 2, fillColor: "#b9f65b", fillOpacity: 1,
      }).bindTooltip(`Pickup: ${pickup}`).addTo(map);
      L.circleMarker(points[points.length - 1], {
        radius: 7, color: "#ffffff", weight: 2, fillColor: "#335cff", fillOpacity: 1,
      }).bindTooltip(`Destination: ${destination}`).addTo(map);
      map.fitBounds(route.getBounds(), { padding: [28, 28], maxZoom: 15 });
    } else if (focusCoordinates) {
      map.setView([focusCoordinates.latitude, focusCoordinates.longitude], 15);
      L.circleMarker([focusCoordinates.latitude, focusCoordinates.longitude], {
        radius: 9, color: "#ffffff", weight: 3, fillColor: "#f97316", fillOpacity: 1,
      }).bindTooltip("Selected map location").addTo(map);
    } else {
      map.setView(DEFAULT_CENTER, 12);
    }

    map.invalidateSize();
    setMapVersion(version => version + 1);
    return () => {
      driverMarkerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [geometry, pickup, destination, focusCoordinates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectionTarget || !onSelectCoordinates) return;
    const container = map.getContainer();
    const previousCursor = container.style.cursor;
    container.style.cursor = "crosshair";
    const selectPoint = (event: L.LeafletMouseEvent) => {
      onSelectCoordinates(event.latlng.lat, event.latlng.lng);
    };
    map.on("click", selectPoint);
    return () => {
      map.off("click", selectPoint);
      container.style.cursor = previousCursor;
    };
  }, [selectionTarget, onSelectCoordinates, mapVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!driverLocation) {
      if (driverMarkerRef.current) map.removeLayer(driverMarkerRef.current);
      driverMarkerRef.current = null;
      return;
    }
    const point = L.latLng(driverLocation.latitude, driverLocation.longitude);
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = L.circleMarker(point, {
        radius: 9, color: "#ffffff", weight: 3, fillColor: "#f97316", fillOpacity: 1,
      }).bindTooltip("Driver's latest reported location · " + new Date(driverLocation.updatedAt).toLocaleTimeString()).addTo(map);
    } else {
      driverMarkerRef.current.setLatLng(point);
      driverMarkerRef.current.setTooltipContent("Driver's latest reported location · " + new Date(driverLocation.updatedAt).toLocaleTimeString());
    }
    if (!map.getBounds().contains(point)) map.panTo(point, { animate: false });
  }, [driverLocation, mapVersion]);

  return <>
    <div ref={elementRef} className="route-map-canvas" role="application"
      aria-label={`${geometry && geometry.length >= 2 ? 'Interactive road map from' : 'Interactive map selection from'} ${pickup} to ${destination}${selectionTarget ? `. Click to select ${selectionTarget}` : ''}${driverLocation ? ". Includes the driver's latest reported location" : ""}. Use map controls to zoom and drag to pan.`} aria-describedby="route-map-description" />
    <p id="route-map-description" className="sr-only">
      {geometry && geometry.length >= 2
        ? `Route map from ${pickup} to ${destination}. The route distance, estimated duration and fare are also provided as text in the booking summary.`
        : `Map selection view for ${pickup} to ${destination}. Choose a pickup or destination selection button, then click the map. You can also type an address or use the current-location button.`}
      {selectionTarget ? ` Click the map to choose the ${selectionTarget}.` : ""}
      {driverLocation ? ` The driver's latest reported location was updated at ${new Date(driverLocation.updatedAt).toLocaleString()}.` : " No driver location is currently shown."}
      OpenStreetMap attribution is available as a link.
    </p>
  </>;
}
