"use strict";

window.GPS_CONFIG = Object.freeze({
    sharingApiUrl: window.PUNTO_DEPLOYMENT ? window.PUNTO_DEPLOYMENT.sharingApiUrl : "",
    initialCenter: [20, 0],
    initialZoom: 2,
    locationZoom: 16,
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    minPointDistance: 5,
    maxPointAccuracy: 100,
    maxRoutePoints: 10000,
    // Use an authorized Nominatim-compatible service for this tracking app.
    reverseGeocodingUrl: "",
    addressMinInterval: 1500,
    geoOptions: { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
});
