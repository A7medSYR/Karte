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
  
  // Status-Anzeige für den optimierten Algorithmus
  const statusDiv = document.createElement('div');
  statusDiv.id = 'optimization-status';
  statusDiv.style.position = 'fixed';
  statusDiv.style.top = '50%';
  statusDiv.style.left = '50%';
  statusDiv.style.transform = 'translate(-50%, -50%)';
  statusDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  statusDiv.style.color = 'white';
  statusDiv.style.padding = '20px';
  statusDiv.style.borderRadius = '5px';
  statusDiv.style.zIndex = '9999';
  statusDiv.style.textAlign = 'center';
  statusDiv.style.minWidth = '250px';
  statusDiv.innerHTML = `
    <div style="font-size: 18px; margin-bottom: 10px;"><i class="fas fa-calculator" style="margin-right: 8px;"></i>Berechne optimale Routenreihenfolge</div>
    <div style="margin-bottom: 15px;">Analysiere mögliche Kombinationen</div>
    <div style="font-size: 13px; opacity: 0.8;">Fortschrittliche Route-Optimierung...</div>
  `;
  document.body.appendChild(statusDiv);
  
  // Verbesserten Algorithmus asynchron ausführen
  setTimeout(() => {
    try {
      // Route berechnen mit verbessertem Algorithmus (2-opt)
      const bestRoute = findOptimizedRoute(allLocations);
      console.log("Berechnete optimale Route:", bestRoute.length, "Standorte");
      
      // Status-Anzeige entfernen
      statusDiv.remove();
      
      // Route auf der Karte darstellen
      displayRoute(bestRoute);
      
      // Fortschrittsanzeige
      updateRouteProgress(bestRoute);
    } catch (error) {
      console.error("Fehler bei Routenberechnung:", error);
      statusDiv.remove();
      alert("Fehler bei der Routenberechnung: " + error.message);
    }
  }, 10);
}

/**
 * Berechnet die optimale Route mit verbessertem Algorithmus
 * @param {Array} locations - Array aller Standorte
 * @returns {Array} - Optimierte Reihenfolge der Standorte
 */
function findOptimizedRoute(locations) {
  // Startpunkt (aktuelle Position)
  const start = locations.find(loc => loc.isStart);
  if (!start) return [];
  
  // Destinations (alle außer Startpunkt)
  const destinations = locations.filter(loc => !loc.isStart);
  
  // Distanzmatrix erstellen
  const n = destinations.length;
  const distances = Array(n + 1).fill().map(() => Array(n + 1).fill(0));
  
  // Startpunkt zu allen Destinationen
  for (let i = 0; i < n; i++) {
    distances[0][i + 1] = calculateDistance(
      start.lat, start.lng,
      destinations[i].lat, destinations[i].lng
    );
    distances[i + 1][0] = distances[0][i + 1]; // Symmetrisch
  }
  
  // Distanzen zwischen Destinationen
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      distances[i + 1][j + 1] = calculateDistance(
        destinations[i].lat, destinations[i].lng,
        destinations[j].lat, destinations[j].lng
      );
      distances[j + 1][i + 1] = distances[i + 1][j + 1]; // Symmetrisch
    }
  }
  
  // 1. Mit Nearest Neighbor eine initiale Lösung erstellen
  let route = [0]; // Startet bei Index 0 (Startpunkt)
  let remaining = Array.from({length: n}, (_, i) => i + 1); // Indizes 1 bis n
  
  while (remaining.length > 0) {
    const last = route[route.length - 1];
    let bestIndex = -1;
    let minDist = Infinity;
    
    // Finde den nächsten Punkt
    for (let i = 0; i < remaining.length; i++) {
      const dist = distances[last][remaining[i]];
      if (dist < minDist) {
        minDist = dist;
        bestIndex = i;
      }
    }
    
    // Füge den nächsten Punkt zur Route hinzu
    route.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }
  
  // 2. 2-opt Optimierung anwenden, um die Route zu verbessern
  let improved = true;
  const MAX_ITERATIONS = 100;
  let iterations = 0;
  
  while (improved && iterations < MAX_ITERATIONS) {
    improved = false;
    iterations++;
    
    // Versuche alle möglichen 2-opt Swaps
    for (let i = 1; i < route.length - 2; i++) {
      for (let j = i + 1; j < route.length - 1; j++) {
        // Berechne aktuelle Distanz
        const d1 = distances[route[i - 1]][route[i]] + 
                  distances[route[j]][route[j + 1]];
        
        // Berechne Distanz nach dem Swap
        const d2 = distances[route[i - 1]][route[j]] + 
                  distances[route[i]][route[j + 1]];
        
        // Wenn der Swap die Route verbessert
        if (d2 < d1) {
          // Führe 2-opt Swap durch (Umkehren der Teilroute)
          route = route.slice(0, i).concat(
            route.slice(i, j + 1).reverse(), 
            route.slice(j + 1)
          );
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  
  console.log(`2-opt Optimierung abgeschlossen nach ${iterations} Iterationen`);
  
  // Konvertiere Indizes zurück zu Standorten
  const optimizedRoute = [start];
  for (let i = 1; i < route.length; i++) {
    optimizedRoute.push(destinations[route[i] - 1]);
  }
  
  return optimizedRoute;
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
  console.log("Zeige Route mit", route.length, "Stops an");
  
  // Routing-Status anzeigen
  const statusDiv = document.createElement('div');
  statusDiv.id = 'routing-status';
  statusDiv.style.position = 'fixed';
  statusDiv.style.top = '50%';
  statusDiv.style.left = '50%';
  statusDiv.style.transform = 'translate(-50%, -50%)';
  statusDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  statusDiv.style.color = 'white';
  statusDiv.style.padding = '20px';
  statusDiv.style.borderRadius = '5px';
  statusDiv.style.zIndex = '9999';
  statusDiv.style.textAlign = 'center';
  statusDiv.style.minWidth = '250px';
  statusDiv.innerHTML = `
    <div style="font-size: 18px; margin-bottom: 10px;"><i class="fas fa-car" style="margin-right: 8px;"></i>Berechne Auto-Route</div>
    <div style="margin-bottom: 15px;">Ermittle beste Strecke über alle Straßen</div>
    <div style="font-size: 13px; opacity: 0.8;">Das kann einen Moment dauern...</div>
  `;
  document.body.appendChild(statusDiv);
  
  // Marker neu nummerieren basierend auf der optimierten Route
  updateMarkerNumbers(route);
  
  // Strecken zwischen aufeinanderfolgenden Punkten mit OSRM berechnen
  calculateOSRMRoutes(route)
    .then(routeCoordinates => {
      statusDiv.remove();
      
      // Vorhandene Route entfernen
      if (routePolyline) {
        map.removeLayer(routePolyline);
      }
      
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
      
      // Legende für die Route hinzufügen
      addRouteLegend(route);
    })
    .catch(error => {
      statusDiv.remove();
      console.error("Fehler beim Berechnen der Straßenroute:", error);
      
      // Fallback: direkte Linien anzeigen, wenn OSRM fehlschlägt
      displayFallbackRoute(route);
      
      // Benutzer informieren
      alert("Die Straßenroute konnte nicht berechnet werden. Es wird eine vereinfachte Route angezeigt.");
    });
}

/**
 * Fallback-Methode zur Anzeige direkter Linien zwischen Punkten
 * @param {Array} route - Die optimierte Route
 */
function displayFallbackRoute(route) {
  // Route-Koordinaten extrahieren
  const routeCoordinates = route.map(loc => [loc.lat, loc.lng]);
  
  // Polyline mit optimierter Farbgebung erstellen
  routePolyline = L.polyline(routeCoordinates, {
    color: '#FF9800',  // Orange für Fallback-Route
    weight: 5,
    opacity: 0.7,
    lineCap: 'round',
    lineJoin: 'round',
    dashArray: '5, 10',  // Gestrichelte Linie für Fallback
    className: 'optimized-route fallback-route'
  }).addTo(map);
  
  // Karte auf die Route zoomen
  map.fitBounds(routePolyline.getBounds(), {
    padding: [50, 50]
  });
  
  // Legende für die Route hinzufügen
  addRouteLegend(route, true);
}

/**
 * Berechnet die tatsächlichen Straßenrouten zwischen aufeinanderfolgenden Punkten mit OSRM
 * @param {Array} route - Die optimierte Route
 * @returns {Promise<Array>} - Versprochene Liste von Koordinaten für die Polyline
 */
async function calculateOSRMRoutes(route) {
  if (route.length < 2) return [];
  
  // Sammle alle Koordinaten für die Route
  let allCoordinates = [];
  
  // Berechne Routen zwischen aufeinanderfolgenden Punkten
  for (let i = 0; i < route.length - 1; i++) {
    // Status aktualisieren
    document.getElementById('routing-status').innerHTML = `
      <div style="font-size: 18px; margin-bottom: 10px;"><i class="fas fa-car" style="margin-right: 8px;"></i>Berechne Auto-Route</div>
      <div style="margin-bottom: 15px;">Segment ${i+1} von ${route.length-1}</div>
      <div class="progress-bar" style="width: 100%; height: 6px; background: #333; border-radius: 3px; margin: 10px 0;">
        <div style="width: ${Math.round((i+1)/(route.length-1)*100)}%; height: 100%; background: #4CAF50; border-radius: 3px;"></div>
      </div>
      <div style="font-size: 13px; opacity: 0.8;">${Math.round((i+1)/(route.length-1)*100)}% abgeschlossen</div>
    `;
    
    const start = route[i];
    const end = route[i+1];
    
    try {
      // Verwende OSRM API, um die Straßenroute zu berechnen
      const coordinates = await getOSRMRoute(
        [start.lng, start.lat],  // OSRM erwartet [lng, lat] anstatt [lat, lng]
        [end.lng, end.lat]
      );
      
      // Füge Koordinaten zur Gesamtroute hinzu
      allCoordinates = allCoordinates.concat(coordinates);
    } catch (error) {
      console.error(`Fehler bei Segment ${i}:`, error);
      // Bei Fehler einfache Linie hinzufügen
      allCoordinates.push([start.lat, start.lng]);
      allCoordinates.push([end.lat, end.lng]);
    }
    
    // Kurze Pause, um API-Limits zu respektieren
    if (i < route.length - 2) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  return allCoordinates;
}

/**
 * Abfrage der OSRM API für eine Route zwischen zwei Punkten
 * @param {Array} start - Startpunkt als [lng, lat]
 * @param {Array} end - Endpunkt als [lng, lat]
 * @returns {Promise<Array>} - Versprochene Liste von Koordinaten für die Route
 */
async function getOSRMRoute(start, end) {
  try {
    // OSRM API-URL mit Koordinaten erstellen
    const url = `https://router.project-osrm.org/route/v1/driving/${start[0]},${start[1]};${end[0]},${end[1]}?overview=full&geometries=geojson`;
    
    // API-Anfrage senden
    const response = await fetch(url);
    const data = await response.json();
    
    // Prüfen, ob eine Route gefunden wurde
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('Keine Route gefunden');
    }
    
    // Koordinaten extrahieren und in Leaflet-Format umwandeln [lat, lng]
    const coordinates = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
    
    return coordinates;
  } catch (error) {
    console.error('OSRM API-Fehler:', error);
    throw error;
  }
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
          
          // Entferne bereits vorhandene Stop-Nummerierung, falls vorhanden
          popupContent = popupContent.replace(/<strong>Stop #\d+<\/strong><br>/g, '');
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
 * @param {boolean} isFallback - Ob es sich um eine Fallback-Route handelt
 */
function addRouteLegend(route, isFallback = false) {
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
      <h4 style="margin:0 0 10px 0; border-bottom: 1px solid #eee; padding-bottom: 8px; font-size: 16px;">
        <i class="fa fa-car" style="margin-right: 5px;"></i>Auto-Route
      </h4>
      <div style="margin-bottom: 8px;"><strong>Stops:</strong> <span style="font-weight:bold; color:#FF5722;">${stopCount} Adressen</span></div>
      <div style="margin-bottom: 8px;"><strong>Distanz:</strong> ${(totalDistance/1000).toFixed(2)} km${isFallback ? ' (Luftlinie)' : ' (Straßen)'}</div>
      <div style="margin-bottom: 8px;"><strong>Start:</strong> Ihr Standort</div>
      <div style="margin-bottom: 8px;"><strong>Fahrmodus:</strong> Auto</div>
      ${isFallback ? '<div style="margin-bottom: 8px; color: #FF9800;"><strong>Hinweis:</strong> Zeigt vereinfachte Route (keine Straßendaten verfügbar)</div>' : ''}
      <div style="margin-top: 10px; font-size: 13px; color: #666; border-top: 1px solid #eee; padding-top: 8px;">
        Die Route ist für Autofahrten optimiert und folgt den Straßen.
        <br>Die Stops sind nach der kürzesten Gesamtstrecke sortiert.
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
    summaryDiv.innerHTML = `<span style="color:#FF5722;">${stopCount}</span> Stops | ${(totalDistance/1000).toFixed(2)} km | Auto`;
    document.body.appendChild(summaryDiv);
  } else {
    document.querySelector('.route-summary-fixed').innerHTML = 
      `<span style="color:#FF5722;">${stopCount}</span> Stops | ${(totalDistance/1000).toFixed(2)} km | Auto`;
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
  findOptimizedRoute,
  displayRoute
}; 