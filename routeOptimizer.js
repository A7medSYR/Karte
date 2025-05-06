/**
 * Route Optimizer Module
 * Berechnet die optimale Route zwischen Stops basierend auf dem aktuellen Standort
 */

// Globale Variablen
let allLocations = [];
let optimizedRoute = [];
let routePolyline = null;

// Event-Listener für DOM-Ladung
document.addEventListener('DOMContentLoaded', function() {
  // Button-Event-Listener hinzufügen
  const optimizeBtn = document.getElementById('optimizeRouteBtn');
  if (optimizeBtn) {
    optimizeBtn.addEventListener('click', optimizeRoute);
  }
});

/**
 * Hauptfunktion zur Berechnung der optimalen Route
 */
function optimizeRoute() {
  console.log("Starte Routenberechnung...");
  
  // Prüfen ob Standortdaten und Ziele vorhanden sind
  if (!lastPosition || !window.addressMarkers || window.addressMarkers.length === 0) {
    alert('Bitte warten Sie auf die GPS-Position und laden Sie die Stops-Datei.');
    console.error("Keine Position oder Addressmarker gefunden:", { lastPosition, markerCount: window.addressMarkers?.length || 0 });
    return;
  }
  
  console.log("lastPosition:", lastPosition);
  
  // Bestehende Route entfernen
  if (routePolyline) {
    map.removeLayer(routePolyline);
  }
  
  // Aktuelle Position als Startpunkt
  let startLat, startLng;
  
  // Je nach Format des lastPosition-Objekts die Koordinaten extrahieren
  if (lastPosition.coords) {
    // Aus Geolocation-API
    startLat = lastPosition.coords.latitude;
    startLng = lastPosition.coords.longitude;
  } else if (lastPosition.latlng) {
    // Aus dem bearbeiteten Format im Code
    startLat = lastPosition.latlng[0];
    startLng = lastPosition.latlng[1];
  } else {
    console.error("Unbekanntes Format für lastPosition:", lastPosition);
    alert("Fehler beim Ermitteln des Standorts. Bitte versuchen Sie es erneut.");
    return;
  }
  
  const startPoint = {
    lat: startLat,
    lng: startLng,
    isStart: true
  };
  
  console.log("Startpunkt:", startPoint);
  
  // Alle Zielmarker sammeln
  allLocations = [];
  allLocations.push(startPoint);
  
  // Addressmarker aus der Hauptanwendung holen
  console.log("Gefundene Marker:", window.addressMarkers.length);
  window.addressMarkers.forEach(marker => {
    const latlng = marker.getLatLng();
    allLocations.push({
      lat: latlng.lat,
      lng: latlng.lng,
      marker: marker
    });
  });
  
  console.log("Gesamtzahl Standorte für Routenberechnung:", allLocations.length);
  
  // Route berechnen mit Nearest Neighbor Algorithmus
  const bestRoute = findNearestNeighborRoute(allLocations);
  console.log("Berechnete optimale Route:", bestRoute.length, "Standorte");
  
  // Route auf der Karte darstellen
  displayRoute(bestRoute);
  
  // Fortschrittsanzeige
  updateRouteProgress(bestRoute);
}

/**
 * Berechnet die optimale Route mit Nearest Neighbor Algorithmus
 * @param {Array} locations - Array aller Standorte
 * @returns {Array} - Optimierte Reihenfolge der Standorte
 */
function findNearestNeighborRoute(locations) {
  // Startpunkt (aktuelle Position)
  const start = locations.find(loc => loc.isStart);
  if (!start) return [];
  
  // Destinations (alle außer Startpunkt)
  const destinations = locations.filter(loc => !loc.isStart);
  
  // Route-Array initialisieren mit dem Startpunkt
  const route = [start];
  let remainingPoints = [...destinations];
  
  // Solange noch Ziele übrig sind
  while (remainingPoints.length > 0) {
    const currentPoint = route[route.length - 1];
    
    // Nächsten Punkt finden
    let nearestPoint = null;
    let minDistance = Infinity;
    
    for (const point of remainingPoints) {
      const distance = calculateDistance(
        currentPoint.lat, currentPoint.lng,
        point.lat, point.lng
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestPoint = point;
      }
    }
    
    // Nächsten Punkt zur Route hinzufügen
    if (nearestPoint) {
      route.push(nearestPoint);
      // Punkt aus der verbleibenden Liste entfernen
      remainingPoints = remainingPoints.filter(p => 
        p.lat !== nearestPoint.lat || p.lng !== nearestPoint.lng
      );
    }
  }
  
  return route;
}

/**
 * Haversine-Formel zur Berechnung der Entfernung zwischen zwei GPS-Koordinaten
 * @param {number} lat1 - Breitengrad des ersten Punkts
 * @param {number} lng1 - Längengrad des ersten Punkts
 * @param {number} lat2 - Breitengrad des zweiten Punkts
 * @param {number} lng2 - Längengrad des zweiten Punkts
 * @returns {number} - Entfernung in Metern
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  // Erdradius in Metern
  const R = 6371000;
  
  // Umrechnung in Radian
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;
  const deltaLat = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLng = ((lng2 - lng1) * Math.PI) / 180;
  
  // Haversine-Formel
  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
          Math.cos(radLat1) * Math.cos(radLat2) *
          Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

/**
 * Route auf der Karte darstellen
 * @param {Array} route - Die optimierte Route
 */
function displayRoute(route) {
  // Route-Koordinaten extrahieren
  const routeCoordinates = route.map(loc => [loc.lat, loc.lng]);
  
  // Polyline mit optimierter Farbgebung erstellen
  routePolyline = L.polyline(routeCoordinates, {
    color: '#2196F3',
    weight: 5,
    opacity: 0.7,
    lineCap: 'round',
    lineJoin: 'round',
    dashArray: '1, 10',
    className: 'optimized-route'
  }).addTo(map);
  
  // Karte auf die Route zoomen
  map.fitBounds(routePolyline.getBounds(), {
    padding: [50, 50]
  });
  
  // Marker neu nummerieren basierend auf der optimierten Route
  updateMarkerNumbers(route);
  
  // Legende für die Route hinzufügen
  addRouteLegend(route);
}

/**
 * Aktualisiert die Nummerierung der Marker auf der Karte
 * @param {Array} route - Die optimierte Route
 */
function updateMarkerNumbers(route) {
  console.log("Aktualisiere Marker-Nummern für", route.length, "Stops");
  
  // Startpunkt überspringen (index 0)
  for (let i = 1; i < route.length; i++) {
    const location = route[i];
    if (location.marker) {
      try {
        console.log(`Aktualisiere Marker #${i}`);
        
        // Bestehenden Popup-Inhalt holen, sofern vorhanden
        let popupContent = "";
        if (location.marker.getPopup()) {
          popupContent = location.marker.getPopup().getContent();
        } else {
          // Wenn kein Popup vorhanden, erstelle ein neues
          location.marker.bindPopup("");
          popupContent = "";
        }
        
        // Nummer hinzufügen
        location.marker.setPopupContent(`<strong>Stop #${i}</strong><br>${popupContent}`);
        
        // Angepasstes divIcon für nummerierte Marker erstellen
        const numberedIcon = L.divIcon({
          className: 'numbered-marker',
          html: `<div class="number-marker">${i}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
        
        // Icon aktualisieren
        location.marker.setIcon(numberedIcon);
      } catch (error) {
        console.error(`Fehler beim Aktualisieren von Marker #${i}:`, error);
      }
    } else {
      console.warn(`Keine Marker-Referenz für Stop #${i}`);
    }
  }
}

/**
 * Fortschritts-Anzeige für die Route erstellen/aktualisieren
 * @param {Array} route - Die optimierte Route
 */
function updateRouteProgress(route) {
  // Berechnen der Gesamtdistanz
  let totalDistance = 0;
  for (let i = 0; i < route.length - 1; i++) {
    totalDistance += calculateDistance(
      route[i].lat, route[i].lng,
      route[i+1].lat, route[i+1].lng
    );
  }
  
  // Anzeige in der Konsole (kann später in UI integriert werden)
  console.log(`Optimierte Route mit ${route.length} Stops und ${(totalDistance/1000).toFixed(2)}km Gesamtdistanz`);
  
  // Hier könnte später eine schönere UI-Integration folgen
}

/**
 * Legende für Route-Optimierung hinzufügen
 * @param {Array} route - Die optimierte Route
 */
function addRouteLegend(route) {
  console.log("Erstelle Routen-Legende für", route.length, "Stops");
  
  // Bestehende Legende entfernen wenn vorhanden
  const existingLegend = document.querySelector('.route-legend-container');
  if (existingLegend) {
    existingLegend.remove();
  }
  
  // Auch Leaflet-Controls mit der Klasse entfernen
  const existingControl = document.querySelector('.leaflet-control.route-summary');
  if (existingControl) {
    existingControl.remove();
  }
  
  // Gesamtdistanz berechnen
  let totalDistance = 0;
  for (let i = 0; i < route.length - 1; i++) {
    totalDistance += calculateDistance(
      route[i].lat, route[i].lng,
      route[i+1].lat, route[i+1].lng
    );
  }
  
  // Anzahl der Stops (ohne Startpunkt)
  const stopCount = route.length - 1;
  
  // Legende-Container erstellen
  const legend = L.control({ position: 'bottomleft', className: 'route-summary' });
  
  legend.onAdd = function() {
    const div = L.DomUtil.create('div', 'route-legend-container');
    div.style.backgroundColor = 'white';
    div.style.padding = '10px';
    div.style.borderRadius = '5px';
    div.style.boxShadow = '0 0 5px rgba(0,0,0,0.2)';
    div.style.maxWidth = '300px';
    div.style.fontSize = '14px';
    
    div.innerHTML = `
      <h4 style="margin:0 0 10px 0; border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 16px;">Optimierte Route</h4>
      <div style="margin-bottom: 8px;"><strong>Stops:</strong> <span style="font-weight:bold; color:#FF5722;">${stopCount} Adressen</span></div>
      <div style="margin-bottom: 8px;"><strong>Distanz:</strong> ${(totalDistance/1000).toFixed(2)} km</div>
      <div style="margin-bottom: 8px;"><strong>Start:</strong> Ihr Standort</div>
      <div style="margin-top: 10px; font-size: 13px; color: #666; border-top: 1px solid #eee; padding-top: 8px;">
        Die Stops sind nach der kürzesten Gesamtstrecke sortiert.
        <br>Jeder Marker zeigt jetzt seine Position in der Route.
      </div>
      <button id="close-legend" style="margin-top: 12px; padding: 6px 12px; background: #f44336; 
        color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;">
        Schließen
      </button>
    `;
    
    return div;
  };
  
  legend.addTo(map);
  
  // Öffentliches Summary-Element hinzufügen
  if (!document.querySelector('.route-summary-fixed')) {
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'route-summary-fixed';
    summaryDiv.style.position = 'fixed';
    summaryDiv.style.top = '85px';
    summaryDiv.style.right = '10px';
    summaryDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
    summaryDiv.style.padding = '8px 12px';
    summaryDiv.style.borderRadius = '4px';
    summaryDiv.style.boxShadow = '0 0 5px rgba(0,0,0,0.2)';
    summaryDiv.style.zIndex = '1000';
    summaryDiv.style.fontWeight = 'bold';
    summaryDiv.innerHTML = `<span style="color:#FF5722;">${stopCount}</span> Stops | ${(totalDistance/1000).toFixed(2)} km`;
    document.body.appendChild(summaryDiv);
  } else {
    document.querySelector('.route-summary-fixed').innerHTML = 
      `<span style="color:#FF5722;">${stopCount}</span> Stops | ${(totalDistance/1000).toFixed(2)} km`;
  }
  
  // Event-Listener für Schließen-Button
  setTimeout(() => {
    const closeBtn = document.getElementById('close-legend');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        map.removeControl(legend);
      });
    }
  }, 100);
}

// Exportiere Funktionen für andere Module
window.routeOptimizer = {
  optimizeRoute,
  findNearestNeighborRoute,
  displayRoute
}; 