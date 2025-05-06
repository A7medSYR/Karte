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
  // Prüfen ob Standortdaten und Ziele vorhanden sind
  if (!lastPosition || !window.addressMarkers || window.addressMarkers.length === 0) {
    alert('Bitte warten Sie auf die GPS-Position und laden Sie die Stops-Datei.');
    return;
  }
  
  // Bestehende Route entfernen
  if (routePolyline) {
    map.removeLayer(routePolyline);
  }
  
  // Aktuelle Position als Startpunkt
  const startPoint = {
    lat: lastPosition.coords.latitude,
    lng: lastPosition.coords.longitude,
    isStart: true
  };
  
  // Alle Zielmarker sammeln
  allLocations = [];
  allLocations.push(startPoint);
  
  // Addressmarker aus der Hauptanwendung holen
  window.addressMarkers.forEach(marker => {
    allLocations.push({
      lat: marker.getLatLng().lat,
      lng: marker.getLatLng().lng,
      marker: marker
    });
  });
  
  // Route berechnen mit Nearest Neighbor Algorithmus
  const bestRoute = findNearestNeighborRoute(allLocations);
  
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
  // Startpunkt überspringen (index 0)
  for (let i = 1; i < route.length; i++) {
    const location = route[i];
    if (location.marker) {
      // Bestehenden Popup-Inhalt holen
      const popupContent = location.marker.getPopup().getContent();
      
      // Nummer hinzufügen
      location.marker.setPopupContent(`<strong>Stop #${i}</strong><br>${popupContent}`);
      
      // Icon-Klasse aktualisieren
      const icon = location.marker.getIcon();
      icon.options.html = `<div class="number-marker">${i}</div>`;
      location.marker.setIcon(icon);
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
  // Bestehende Legende entfernen wenn vorhanden
  const existingLegend = document.querySelector('.route-legend-container');
  if (existingLegend) {
    existingLegend.remove();
  }
  
  // Gesamtdistanz berechnen
  let totalDistance = 0;
  for (let i = 0; i < route.length - 1; i++) {
    totalDistance += calculateDistance(
      route[i].lat, route[i].lng,
      route[i+1].lat, route[i+1].lng
    );
  }
  
  // Legende-Container erstellen
  const legend = L.control({ position: 'bottomleft' });
  
  legend.onAdd = function() {
    const div = L.DomUtil.create('div', 'route-legend-container');
    div.style.backgroundColor = 'white';
    div.style.padding = '10px';
    div.style.borderRadius = '5px';
    div.style.boxShadow = '0 0 5px rgba(0,0,0,0.2)';
    div.style.maxWidth = '300px';
    
    div.innerHTML = `
      <h4 style="margin:0 0 5px 0; border-bottom: 1px solid #eee; padding-bottom: 5px;">Optimierte Route</h4>
      <div style="margin-bottom: 5px;"><strong>Stops:</strong> ${route.length - 1} Adressen</div>
      <div style="margin-bottom: 5px;"><strong>Distanz:</strong> ${(totalDistance/1000).toFixed(2)} km</div>
      <div style="margin-bottom: 5px;"><strong>Start:</strong> Ihr Standort</div>
      <div style="margin-top: 8px; font-size: 12px; color: #666;">
        Die Stops sind nach der kürzesten Gesamtstrecke sortiert.
      </div>
      <button id="close-legend" style="margin-top: 10px; padding: 5px 10px; background: #f5f5f5; 
        border: 1px solid #ddd; border-radius: 3px; cursor: pointer; font-size: 12px;">
        Schließen
      </button>
    `;
    
    return div;
  };
  
  legend.addTo(map);
  
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