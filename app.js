let watchId = null;
let userMarker = null;
let userCircle = null;
let tracking = true;
let lastPosition = null;
let positionHistory = [];
let map;
// Variable für Screen Wake Lock
let wakeLock = null;

// Neue globale Variablen für die Routenführung
let routeControl = null;
let stopMarkers = [];
let currentRouteIndex = 0;
let isNavigating = false;
let routeLayer = null; // Für die Routendarstellung
let optimizedRoute = []; // Optimierte Reihenfolge der Stops
let remainingStops = 0; // Anzahl der verbleibenden Stops
let completedStops = 0; // Anzahl der absolvierten Stops
let stopPanel = null; // Panel für Stop-Informationen

// Deutsche Straßen- und Ortssynonyme für verbesserte Geocodierung
const streetSynonyms = {
  'str': 'straße',
  'str.': 'straße',
  'strasse': 'straße',
  'ave': 'allee',
  'avenue': 'allee',
  'platz': 'platz',
  'pl': 'platz',
  'pl.': 'platz',
  'weg': 'weg',
  'gasse': 'gasse',
  'pfad': 'pfad',
  'ring': 'ring'
};

// Hilfsfunktion zur Normalisierung von Straßennamen
function normalizeStreetName(street) {
  if (!street) return '';
  
  let normalized = street.toLowerCase().trim();
  
  // Finde den Straßentyp am Ende des Namens
  const words = normalized.split(/\s+/);
  if (words.length > 1) {
    const lastWord = words[words.length - 1];
    const streetType = streetSynonyms[lastWord];
    
    if (streetType) {
      // Ersetze den Straßentyp mit der standardisierten Version
      words[words.length - 1] = streetType;
      normalized = words.join(' ');
    }
  }
  
  return normalized;
}

// 1) Leaflet & Geolocation-Setup
function initMap() {
  map = L.map('map', {
    minZoom: 4,
    maxZoom: 20,
    zoomControl: true
  }).setView([49.5, 7.0], 14);
  
  // NEUE 2024 OSMC-TOPO KARTE (Deutschland-optimiert, KEIN API-SCHLÜSSEL)
  // Hochaktuelle Daten mit täglicher Aktualisierung, höchste Detailstufe
  L.tileLayer('https://tile.osmand.net/hd/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://osmand.net">OsmAnd 2024</a> | <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  
  // Marker-Icons für die Stops
  bluePin = L.divIcon({
    className: 'stop-marker-container',
    html: '<div class="stop-marker-number">?</div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  
  yellowPin = L.divIcon({
    className: 'stop-marker-container',
    html: '<div class="stop-marker-number" style="color:#FF9800">?</div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  
  greenPin = L.divIcon({
    className: 'stop-marker-container',
    html: '<div class="stop-marker-number" style="color:#4CAF50">✓</div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  
  // Funktion zum Erstellen eines nummerierten Markers
  createNumberedMarker = function(number, hasHint = false, visited = false) {
    let color = '#1E88E5'; // Standard: Blau
    let content = number;
    
    if (hasHint) color = '#FF9800'; // Gelb für Hinweise
    if (visited) {
      color = '#4CAF50'; // Grün für besuchte Stops
      content = '✓';
    }
    
    return L.divIcon({
      className: 'stop-marker-container',
      html: `<div class="stop-marker-number" style="color:${color}">${content}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  };
  
  // Gebäude-Layer automatisch aktivieren
  let buildingsLayer;
  let currentBuildingsBounds = null;
  
  // Funktion zum Laden von Gebäuden mit Hausnummern (neu 2024)
  function loadBuildings() {
    if (map.getZoom() < 16) return;
    
    const bounds = map.getBounds();
    
    // Vermeide zu häufiges Nachladen
    if (currentBuildingsBounds && currentBuildingsBounds.contains(bounds)) {
      return;
    }
    
    // Erweitere den Bereich etwas
    const expandedBounds = bounds.pad(0.3);
    currentBuildingsBounds = expandedBounds;
    
    const south = expandedBounds.getSouth();
    const west = expandedBounds.getWest();
    const north = expandedBounds.getNorth();
    const east = expandedBounds.getEast();
    
    // Overpass API Abfrage für deutsche Gebäude mit Hausnummern (2024)
    // Hochoptimierte Abfrage für schnellere Ergebnisse
    const query = `
      [out:json][timeout:25];
      (
        // Priorität 1: Gebäude mit Hausnummern und kompletten Adressen
        way["building"]["addr:housenumber"](${south},${west},${north},${east});
        relation["building"]["addr:housenumber"](${south},${west},${north},${east});
        
        // Priorität 2: Neu hinzugefügte/aktualisierte Gebäude (seit 2023)
        way["building"](newer:"2023-01-01T00:00:00Z")(${south},${west},${north},${east});
        relation["building"](newer:"2023-01-01T00:00:00Z")(${south},${west},${north},${east});
        
        // Priorität 3: Gebäude mit Straße aber ohne Hausnummer
        way["building"]["addr:street"](${south},${west},${north},${east});
        relation["building"]["addr:street"](${south},${west},${north},${east});
      );
      out body;
      >;
      out skel qt;
    `;
    
    // Ladeanzeige
    let loadingElement = document.getElementById('loading-buildings');
    if (!loadingElement) {
      const loadingIndicator = L.control({ position: 'bottomleft' });
      loadingIndicator.onAdd = function() {
        const div = L.DomUtil.create('div', 'loading-indicator');
        div.innerHTML = '<div style="background: white; padding: 5px; border-radius: 4px; display: inline-block;">Aktualisierung.. </div>';
        div.id = 'loading-buildings';
        return div;
      };
      loadingIndicator.addTo(map);
    }
    
    // Overpass-API (ohne Schlüssel, täglich aktualisierte Daten)
    fetch('https://overpass.kumi.systems/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query)
    })
    .then(response => response.json())
    .then(data => {
      // Bestehenden Layer entfernen
      if (buildingsLayer) {
        map.removeLayer(buildingsLayer);
      }
      
      // GeoJSON erstellen
      const buildings = osmtogeojson(data);
      
      // Gebäude als Layer hinzufügen
      buildingsLayer = L.geoJSON(buildings, {
        style: function(feature) {
          // Aktuelles Farbschema 2024
          return {
            color: '#3476c2',
            weight: 1.5,
            fillColor: '#3476c2',
            fillOpacity: 0.2,
            opacity: 0.8
          };
        },
        onEachFeature: function(feature, layer) {
          // Hausnummern und Infos im Popup
          if (feature.properties && feature.properties.tags) {
            const tags = feature.properties.tags;
            let popupContent = '';
            
            // Adressinformationen
            if (tags['addr:housenumber']) {
              popupContent += `<strong>Nr.:</strong> ${tags['addr:housenumber']}<br>`;
            }
            
            if (tags['addr:street']) {
              popupContent += `<strong>Straße:</strong> ${tags['addr:street']}<br>`;
            }
            
            if (tags['addr:postcode']) {
              popupContent += `<strong>PLZ:</strong> ${tags['addr:postcode']}<br>`;
            }
            
            // Gebäudeinfo
            if (tags.name) {
              popupContent += `<strong>Name:</strong> ${tags.name}<br>`;
            }
            
            // Baujahr (falls verfügbar)
            if (tags['start_date']) {
              popupContent += `<strong>Baujahr:</strong> ${tags['start_date']}<br>`;
            }
            
            if (popupContent) {
              layer.bindPopup(popupContent);
            }
          }
        }
      }).addTo(map);
      
      // Ladeanzeige entfernen
      loadingElement = document.getElementById('loading-buildings');
      if (loadingElement) {
        loadingElement.remove();
      }
    })
    .catch(error => {
      console.error('Fehler beim Laden der Gebäude:', error);
      
      // Alternativer Overpass-Server bei Fehler
      fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query)
      })
      .then(response => response.json())
      .then(data => {
        if (buildingsLayer) {
          map.removeLayer(buildingsLayer);
        }
        
        const buildings = osmtogeojson(data);
        buildingsLayer = L.geoJSON(buildings, {
          // Gleiche Konfiguration wie oben
          style: function(feature) {
            return {
              color: '#3476c2',
              weight: 1.5,
              fillColor: '#3476c2',
              fillOpacity: 0.2,
              opacity: 0.8
            };
          },
          onEachFeature: function(feature, layer) {
            if (feature.properties && feature.properties.tags) {
              const tags = feature.properties.tags;
              let popupContent = '';
              
              if (tags['addr:housenumber']) {
                popupContent += `<strong>Nr.:</strong> ${tags['addr:housenumber']}<br>`;
              }
              
              if (tags['addr:street']) {
                popupContent += `<strong>Straße:</strong> ${tags['addr:street']}<br>`;
              }
              
              if (tags['addr:postcode']) {
                popupContent += `<strong>PLZ:</strong> ${tags['addr:postcode']}<br>`;
              }
              
              if (tags.name) {
                popupContent += `<strong>Name:</strong> ${tags.name}<br>`;
              }
              
              if (tags['start_date']) {
                popupContent += `<strong>Baujahr:</strong> ${tags['start_date']}<br>`;
              }
              
              if (popupContent) {
                layer.bindPopup(popupContent);
              }
            }
          }
        }).addTo(map);
        
        // Ladeanzeige entfernen
        loadingElement = document.getElementById('loading-buildings');
        if (loadingElement) {
          loadingElement.remove();
        }
      })
      .catch(err => {
        console.error('Auch alternativer Server fehlgeschlagen:', err);
        
        // Ladeanzeige entfernen
        loadingElement = document.getElementById('loading-buildings');
        if (loadingElement) {
          loadingElement.remove();
        }
      });
    });
  }
  
  // Gebäude bei Kartenbewegung nachladen
  map.on('moveend', loadBuildings);
  map.on('zoomend', function() {
    // Gebäude nur bei hohem Zoom laden
    if (map.getZoom() >= 16) {
      loadBuildings();
    } else if (buildingsLayer) {
      map.removeLayer(buildingsLayer);
      buildingsLayer = null;
    }
  });
  
  // Maßstabsanzeige
  L.control.scale({
    imperial: false,
    metric: true,
    position: 'bottomright'
  }).addTo(map);
  
  // Genauigkeitsanzeige
  const accuracyInfo = L.control({ position: 'bottomleft' });
  accuracyInfo.onAdd = function() {
    const div = L.DomUtil.create('div', 'accuracy-info');
    div.innerHTML = '<div id="accuracy" style="background: white; padding: 5px; border-radius: 4px; display: inline-block;"></div>';
    return div;
  };
  accuracyInfo.addTo(map);
  
  // Standortverfolgung-Button
  const locateControl = L.control({ position: 'topright' });
  locateControl.onAdd = () => {
    const btn = L.DomUtil.create('button', 'locate-button');
    btn.id = 'locate-btn';
    btn.textContent = '⏸️ Stoppen';
    btn.title = 'Standortverfolgung ein-/ausschalten';
    L.DomEvent.on(btn, 'click', e => {
      L.DomEvent.stopPropagation(e);
      toggleTracking();
    });
    return btn;
  };
  locateControl.addTo(map);
  
  // Standortverfolgung starten
  startTracking();
}

// Verbesserte Standortverfolgung mit maximaler Genauigkeit
function startTracking() {
  if (watchId) return;

  const geoOptions = {
    enableHighAccuracy: true,  // Höchste Genauigkeit anfordern
    maximumAge: 0,             // Immer aktuelle Position verwenden
    timeout: 2000              // 2 Sekunden Timeout (schnellere Updates)
  };

  watchId = navigator.geolocation.watchPosition(
    position => updatePosition(position),
    error => {
      console.error('Geolocation Fehler:', error);
      // Disable error alert
      // alert(`Standortbestimmung fehlgeschlagen: ${error.message}`);
      stopTracking();
    },
    geoOptions
  );
}

// Optimierte Positionsverarbeitung mit erweitertem Kalman-Filter-Ansatz
function updatePosition(position) {
  const { latitude, longitude, accuracy, heading, speed } = position.coords;
  const timestamp = Date.now();
  const latlng = [latitude, longitude];

  // Nur Positionen mit höherer Genauigkeit akzeptieren (z.B. < 30 Meter)
  if (accuracy > 50) {
    console.warn('Position verworfen wegen zu geringer Genauigkeit:', accuracy);
    return;
  }

  // Position in Historie speichern für Glättung und Filter
  positionHistory.push({latlng, accuracy, timestamp, heading, speed});

  // Historie auf maximal 5 Positionen begrenzen für bessere Dynamik
  if (positionHistory.length > 5) {
    positionHistory.shift();
  }

  // Ausreißer erkennen und ignorieren (z.B. Sprünge > 200m zur letzten Position)
  if (positionHistory.length > 1) {
    const prev = positionHistory[positionHistory.length - 2].latlng;
    const dist = Math.sqrt(Math.pow(latlng[0] - prev[0], 2) + Math.pow(latlng[1] - prev[1], 2)) * 111320; // Meter
    if (dist > 200) {
      console.warn('Ausreißer erkannt und ignoriert:', dist, 'Meter');
      positionHistory.pop();
      return;
    }
  }

  // Adaptive Positionsfilterung basierend auf Genauigkeit und Geschwindigkeit
  let filteredPosition = latlng;
  let filteredAccuracy = accuracy;

  // Adaptive Filter-Logik basierend auf Bewegungsparameter
  if (positionHistory.length >= 3) {
    // Bestimme, ob stationär oder in Bewegung
    const isMoving = speed !== null && speed > 0.8; // Bewegungsschwelle bei 0.8 m/s (ca. 3 km/h)

    if (isMoving) {
      // Bei Bewegung: Weniger Dämpfung, mehr aktuelle Position berücksichtigen
      // Gewichtung zugunsten neuer Messungen (bei hoher Geschwindigkeit)
      const weights = calculateWeights(positionHistory, 'moving');
      filteredPosition = calculateWeightedPosition(positionHistory, weights);

      // Bei höherer Geschwindigkeit ist die aktuelle Genauigkeit wichtiger
      filteredAccuracy = accuracy;
    } else {
      // Bei Stillstand: Mehr Dämpfung, stärkere Glättung
      // Bewerte Positionen nach Genauigkeit (bei Stillstand)
      const weights = calculateWeights(positionHistory, 'stationary');
      filteredPosition = calculateWeightedPosition(positionHistory, weights);

      // Bei Stillstand können wir die Genauigkeit durch Mittelung verbessern
      // Gewichteter Durchschnitt der Genauigkeiten, bevorzugt genauere Werte
      filteredAccuracy = positionHistory.reduce((sum, pos, idx) => {
        // Genauere Messungen höher gewichten
        const accuracyWeight = 1.0 / Math.max(0.1, pos.accuracy);
        return sum + (pos.accuracy * accuracyWeight);
      }, 0) / positionHistory.reduce((sum, pos) => sum + (1.0 / Math.max(0.1, pos.accuracy)), 0);
    }
  }

  // Heading-Glättung für flüssigere Rotation
  let filteredHeading = heading;
  if (heading !== null && positionHistory.length >= 2) {
    // Sammle alle verfügbaren Heading-Werte
    const headings = positionHistory
      .filter(pos => pos.heading !== null)
      .map(pos => pos.heading);

    if (headings.length >= 2) {
      // Verwende gleitenden Durchschnitt für Heading mit spezieller Behandlung für 0/360-Grad-Übergang
      filteredHeading = calculateAverageHeading(headings);
    }
  }

  // Karte auf aktuelle Position zentrieren, wenn Tracking aktiv
  if (tracking) {
    // Sanftes Zoomen basierend auf Geschwindigkeit
    let zoomLevel = 19; // Standardzoom

    // Dynamischer Zoom basierend auf Geschwindigkeit
    if (speed !== null) {
      if (speed > 19) { // Schnell (> 72 km/h)
        zoomLevel = 17;
      } else if (speed > 8) { // Mittel (> 29 km/h)
        zoomLevel = 17;
      } else if (speed > 3) { // Langsam (> 11 km/h)
        zoomLevel = 17;
      }
    }

    // Sanfte Animation beim Zentrieren mit angepasster Dauer
    map.setView(filteredPosition, zoomLevel, {
      animate: true,
      duration: 0.3, // Schnellere Animation für flüssigeres Erlebnis
      easeLinearity: 0.5
    });
  }

  // Marker für Benutzerposition aktualisieren oder erstellen
  if (!userMarker) {
    userMarker = L.marker(filteredPosition, {
      icon: L.divIcon({
        className: 'user-marker',
        html: '<div class="position-dot"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      }),
      rotationAngle: filteredHeading || 0,
      rotationOrigin: 'center center'
    }).addTo(map).bindPopup('Mein Standort');
  } else {
    userMarker.setLatLng(filteredPosition);
    if (filteredHeading !== null) userMarker.setRotationAngle(filteredHeading);
  }

  // Genauigkeitskreis aktualisieren oder erstellen
  if (!userCircle) {
    userCircle = L.circle(filteredPosition, {
      radius: filteredAccuracy,
      color: '#4285F4',
      fillColor: '#4285F4',
      fillOpacity: 0.1,
      weight: 1
    }).addTo(map);
  } else {
    userCircle.setLatLng(filteredPosition);
    userCircle.setRadius(filteredAccuracy);
  }

  // Genauigkeitsanzeige
  document.getElementById('accuracy').innerHTML = `
    <strong>Genauigkeit:</strong> ${Math.round(filteredAccuracy)} m
    ${speed !== null ? `<br><strong>Geschwindigkeit:</strong> ${Math.round(speed * 3.6)} km/h` : ''}
  `;

  lastPosition = {latlng: filteredPosition, accuracy: filteredAccuracy, heading: filteredHeading, speed};

  if (isNavigating && stopMarkers.length > 0 && currentRouteIndex >= 0) {
    const currentStop = stopMarkers[currentRouteIndex];
    if (!currentStop.visited) {
      // Prüfe, ob wir in der Nähe des aktuellen Stops sind (Amazon-style - größerer Radius)
      const stopPosition = currentStop.position;
      const distanceToStop = Math.sqrt(
        Math.pow((stopPosition.lat - filteredPosition[0]) * 111320, 2) + 
        Math.pow((stopPosition.lng - filteredPosition[1]) * 111320 * Math.cos(filteredPosition[0] * Math.PI / 180), 2)
      );
      
      // Wenn nahe genug am Stop oder wenn Gerät sich langsam bewegt
      const isNearStop = distanceToStop < 30; // Erhöhter Radius (30m)
      const isSlowMoving = speed < 1.0; // Langsame Bewegung (weniger als 3.6 km/h)
      
      if (isNearStop && isSlowMoving) {
        // Akustisches Signal beim Erreichen des Stops
        const notification = new Audio('data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAAKAAAHcAAUFBQUFBQUFCwsLCwsLCws' +
        'QEBAQEBAQEBVVVVVVVVVVWpqampqampqgICAgICAgICVlZWVlZWVlautra2tra2twMDAwMDAwMDV1dXV1dXV1f///' +
        '/8AAABQTEFNRTMuMTAwBEgAAAAAAAAAFCAkBTSDgAACkAAHcHYc4EAAAAAAA');
        notification.play();
        
        // Verzögere das Markieren um 1 Sekunde, um versehentliches Passieren zu vermeiden
        setTimeout(() => {
          if (!currentStop.visited) {
            markStopAsVisited(currentRouteIndex);
          }
        }, 1000);
      }
    }
  }
}

// Hilfsfunktionen für Filter und Glättung
function calculateWeights(history, mode) {
  // Modus "moving": Neuere Positionen stärker gewichten
  // Modus "stationary": Genauere Positionen stärker gewichten
  if (mode === 'moving') {
    const n = history.length;
    return history.map((_, i) => 0.1 + 0.9 * (i + 1) / n); // Stärker linear ansteigend
  } else {
    return history.map(pos => 1.0 / Math.max(0.1, pos.accuracy * 0.8)); // Genauere Werte stärker bevorzugen
  }
}

function calculateWeightedPosition(history, weights) {
  let sumLat = 0, sumLng = 0, sumWeight = 0;
  for (let i = 0; i < history.length; i++) {
    sumLat += history[i].latlng[0] * weights[i];
    sumLng += history[i].latlng[1] * weights[i];
    sumWeight += weights[i];
  }
  return [sumLat / sumWeight, sumLng / sumWeight];
}

function calculateAverageHeading(headings) {
  // Mittelwert unter Berücksichtigung von 0/360-Übergang
  let sinSum = 0, cosSum = 0;
  for (const h of headings) {
    sinSum += Math.sin(h * Math.PI / 180);
    cosSum += Math.cos(h * Math.PI / 180);
  }
  return (Math.atan2(sinSum, cosSum) * 180 / Math.PI + 360) % 360;
}

function stopTracking() {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function toggleTracking() {
  tracking = !tracking;
  const btn = document.getElementById('locate-btn');
  btn.textContent = tracking ? '⏸️ Stoppen' : '▶️ Folgen';
  
  if (tracking && lastPosition) {
    map.setView(lastPosition.latlng, 18);
  }
}

// 2) Adress-Parsen mit Hausnummer (inkl. Buchstaben) - Spezielle deutsche Adressformate
function parseAddress(combined) {
  // Eingabe normalisieren: Zuerst trimmen und dann nach Komma aufteilen
  const parts = combined.split(',').map(s => s.trim());
  const addrPart = parts[0];
  const ort = parts.length > 1 ? parts[1] : '';
  
  // Deutsche Straßenbezeichnungen (häufig mit Leerzeichen)
  const streetSuffixes = [
    'allee', 'chaussee', 'damm', 'gasse', 'pfad', 'platz', 'ring', 'straße', 'str.', 'str', 
    'weg', 'ufer', 'markt', 'promenade', 'zeile'
  ];
  
  // 1. Methode: Regulärer Ausdruck für das häufigste Format "Straße Hausnummer"
  const standardMatch = addrPart.match(/^(.+?)\s+(\d+\s*[a-zA-Z0-9\/\-]*)$/u);
  if (standardMatch) {
    return { 
      strasse: standardMatch[1].trim(), 
      hausnr: standardMatch[2].trim(), 
      ort 
    };
  }
  
  // 2. Methode: Nach dem letzten Wort suchen, das wie eine Hausnummer aussieht
  const words = addrPart.split(/\s+/);
  let hausnrIndex = -1;
  
  // Von hinten nach vorne durchgehen und nach einer Hausnummer suchen
  for (let i = words.length - 1; i >= 0; i--) {
    if (/^\d+[a-zA-Z0-9\/\-]*$/.test(words[i])) {
      hausnrIndex = i;
      break;
    }
  }
  
  if (hausnrIndex >= 0) {
    const hausnr = words[hausnrIndex];
    const strasse = words.slice(0, hausnrIndex).join(' ');
    return { strasse, hausnr, ort };
  }
  
  // 3. Methode: Prüfe auf typische deutsche Straßennamen mit Leerzeichen vor der Hausnummer
  for (let i = words.length - 2; i >= 0; i--) {
    const potentialStreetSuffix = words[i].toLowerCase().replace(/[^\wäöüß]/g, '');
    if (streetSuffixes.includes(potentialStreetSuffix)) {
      // Das Wort nach dem Straßentyp könnte die Hausnummer sein
      if (i < words.length - 1 && /^\d+[a-zA-Z0-9\/\-]*$/.test(words[i+1])) {
        const hausnr = words[i+1];
        const strasse = words.slice(0, i+1).join(' ');
        return { strasse, hausnr, ort };
      }
    }
  }
  
  // 4. Fallback: Wenn nichts funktioniert, betrachte das letzte Wort als Hausnummer
  const hausnr = words.pop() || '';
  const strasse = words.join(' ');
  
  return { strasse, hausnr, ort };
}

// 3) Verbesserte Geocoding-Strategie für deutsche Adressen
const cache = {};
async function geocodeNominatim(strasse, hausnr, ort) {
  try {
    // Sicherstellen, dass Eingabeparameter gültig sind
    const formattedStreet = strasse ? strasse.trim() : '';
    const formattedHausnr = hausnr ? hausnr.trim() : '';
    const formattedOrt = ort ? ort.trim() : '';
    
    // Cache-Schlüssel: Adressen normalisieren für bessere Cache-Trefferrate
    const cacheKey = `${formattedStreet.toLowerCase()}|${formattedHausnr.toLowerCase()}|${formattedOrt.toLowerCase()}`;
    if (cache[cacheKey]) {
      console.log('Adresse aus Cache geladen:', cacheKey);
      return cache[cacheKey];
    }
    
    // Strategie 1: Formatierte strukturierte Suche (Straße + Hausnummer, Stadt)
    // Diese Strategie funktioniert am besten für Standardadressen
    const params1 = new URLSearchParams({ 
      format: 'json', 
      street: `${formattedStreet} ${formattedHausnr}`,
      city: formattedOrt,
      country: 'de',
      limit: '1',
      addressdetails: '1'
    });
    
    console.log(`Nominatim Strategie 1: "${formattedStreet} ${formattedHausnr}, ${formattedOrt}"`);
    
    const res1 = await fetch(`https://nominatim.openstreetmap.org/search?${params1}`, { 
      headers: { 
        'User-Agent': 'OberthalMap/1.0',
        'Accept-Language': 'de',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      }
    });
    
    const data1 = await res1.json();
    
    if (data1.length > 0) {
      const result = [parseFloat(data1[0].lat), parseFloat(data1[0].lon)];
      cache[cacheKey] = result;
      console.log('Nominatim Strategie 1 erfolgreich:', data1[0].display_name);
      return result;
    }
    
    // Strategie 2: Hausnummernmodifikation für Buchstaben (z.B. "9A" -> "9")
    const hasLetterInNumber = /^(\d+)([a-zA-Z].*)$/i.test(formattedHausnr);
    if (hasLetterInNumber) {
      const numericPart = formattedHausnr.match(/^(\d+)/)[1];
      console.log(`Nominatim Strategie 2: Hausnummer vereinfachen "${formattedStreet} ${numericPart}, ${formattedOrt}"`);
      
      const params2 = new URLSearchParams({ 
        format: 'json', 
        street: `${formattedStreet} ${numericPart}`,
        city: formattedOrt,
        country: 'de',
        limit: '1'
      });
      
      const res2 = await fetch(`https://nominatim.openstreetmap.org/search?${params2}`, { 
        headers: { 
          'User-Agent': 'OberthalMap/1.0',
          'Accept-Language': 'de'
        }
      });
      
      const data2 = await res2.json();
      
      if (data2.length > 0) {
        const result = [parseFloat(data2[0].lat), parseFloat(data2[0].lon)];
        cache[cacheKey] = result;
        console.log('Nominatim Strategie 2 erfolgreich (vereinfachte Hausnummer):', data2[0].display_name);
        return result;
      }
    }
    
    // Strategie 3: Q-Parameter mit formatierter Adresse
    // Bessere Ergebnisse für ungewöhnliche Adressen oder wenn die Straße falsch geschrieben ist
    const formattedAddress = `${formattedStreet} ${formattedHausnr}, ${formattedOrt}, Deutschland`;
    const params3 = new URLSearchParams({ 
      format: 'json', 
      q: formattedAddress,
      limit: '1',
      countrycodes: 'de'
    });
    
    console.log(`Nominatim Strategie 3: Freie Suche "${formattedAddress}"`);
    
    const res3 = await fetch(`https://nominatim.openstreetmap.org/search?${params3}`, { 
      headers: { 
        'User-Agent': 'OberthalMap/1.0',
        'Accept-Language': 'de'
      }
    });
    
    const data3 = await res3.json();
    
    if (data3.length > 0) {
      const result = [parseFloat(data3[0].lat), parseFloat(data3[0].lon)];
      cache[cacheKey] = result;
      console.log('Nominatim Strategie 3 erfolgreich:', data3[0].display_name);
      return result;
    }
    
    // Strategie 4: Freie Suche mit vereinfachter Hausnummer (ohne Buchstaben)
    if (hasLetterInNumber) {
      const numericPart = formattedHausnr.match(/^(\d+)/)[1];
      const simpleAddress = `${formattedStreet} ${numericPart}, ${formattedOrt}, Deutschland`;
      
      const params4 = new URLSearchParams({ 
        format: 'json', 
        q: simpleAddress,
        limit: '1',
        countrycodes: 'de'
      });
      
      console.log(`Nominatim Strategie 4: Freie Suche mit vereinfachter Hausnummer "${simpleAddress}"`);
      
      const res4 = await fetch(`https://nominatim.openstreetmap.org/search?${params4}`, { 
        headers: { 
          'User-Agent': 'OberthalMap/1.0',
          'Accept-Language': 'de'
        }
      });
      
      const data4 = await res4.json();
      
      if (data4.length > 0) {
        const result = [parseFloat(data4[0].lat), parseFloat(data4[0].lon)];
        cache[cacheKey] = result;
        console.log('Nominatim Strategie 4 erfolgreich (freie Suche + vereinfachte Hausnummer):', data4[0].display_name);
        return result;
      }
    }
    
    // Weiterhin die restlichen Strategien ausführen...
    // ... existing code ...
    
    // Strategie 5: Nur die Stadt/Gemeinde suchen, wenn nichts anderes funktioniert
    if (formattedOrt) {
      const params5 = new URLSearchParams({ 
        format: 'json', 
        q: `${formattedOrt}, Deutschland`,
        limit: '1'
      });
      
      console.log(`Nominatim Strategie 5: Nur Ort "${formattedOrt}, Deutschland"`);
      
      const res5 = await fetch(`https://nominatim.openstreetmap.org/search?${params5}`, { 
        headers: { 
          'User-Agent': 'OberthalMap/1.0',
          'Accept-Language': 'de'
        }
      });
      
      const data5 = await res5.json();
      
      if (data5.length > 0) {
        const result = [parseFloat(data5[0].lat), parseFloat(data5[0].lon)];
        cache[cacheKey] = result;
        console.log('Nominatim Strategie 5 erfolgreich (nur Ort):', data5[0].display_name);
        return result;
      }
    }
    
    console.warn('Alle Nominatim-Strategien fehlgeschlagen für:', `${formattedStreet} ${formattedHausnr}, ${formattedOrt}`);
    return null;
  } catch (error) {
    console.error('Nominatim Geocoding-Fehler:', error);
    return null;
  }
}

// Hauptgeocode-Funktion mit optimierter Strategie für deutsche Adressen
async function geocode(strasse, hausnr, ort) {
  try {
    // Normalisierung der Eingabe
    strasse = strasse ? strasse.trim() : '';
    hausnr = hausnr ? hausnr.trim() : '';
    ort = ort ? ort.trim() : '';
    
    // Prüfen ob Hausnummer einen Buchstaben enthält
    const hasLetters = /^(\d+)([a-zA-Z].*)$/i.test(hausnr);
    let numericPart = null;
    
    if (hasLetters) {
      numericPart = hausnr.match(/^(\d+)/)[1];
      console.log(`Hausnummer mit Buchstaben erkannt: ${hausnr} -> Basisnummer: ${numericPart}`);
    }
    
    // Normalisiere den Straßennamen für bessere Ergebnisse
    const normalizedStrasse = normalizeStreetName(strasse);
    
    // Cache-Key mit Kleinschreibung für bessere Trefferquote
    const key = `${normalizedStrasse.toLowerCase()}|${hausnr.toLowerCase()}|${ort.toLowerCase()}`;
    if (cache[key]) {
      console.log('Adresse aus Cache geladen:', key);
      return cache[key];
    }

    console.log('Geocode-Anfrage für:', `${strasse} ${hausnr}, ${ort}`);
    
    // Versuche direkt mit reduzierter Hausnummer, falls buchstabenhaltige Hausnummer vorliegt
    let directResult = null;
    
    // 1. Erster Versuch mit voller Hausnummer (inkl. Buchstaben)
    directResult = await geocodeNominatim(normalizedStrasse, hausnr, ort);
    
    if (directResult) {
      const resultObj = {
        coordinates: directResult,
        accuracy: 'approximate',
        source: 'nominatim'
      };
      
      cache[key] = resultObj;
      return resultObj;
    }
    
    // 2. Falls keine Ergebnisse und Hausnummer hat Buchstaben, versuche mit reduzierter Hausnummer
    if (!directResult && hasLetters && numericPart) {
      console.log(`Versuche mit reduzierter Hausnummer: ${numericPart}`);
      
      const reducedKey = `${normalizedStrasse.toLowerCase()}|${numericPart.toLowerCase()}|${ort.toLowerCase()}`;
      
      // Erst im Cache suchen
      if (cache[reducedKey]) {
        console.log('Reduzierte Adresse aus Cache geladen:', reducedKey);
        const resultObj = {
          ...cache[reducedKey],
          originalHausnr: hausnr,
          reducedHausnr: numericPart,
          isReduced: true
        };
        
        // Speichere auch unter originalem Schlüssel
        cache[key] = resultObj;
        return resultObj;
      }
      
      // Dann mit reduzierter Hausnummer versuchen
      const reducedResult = await geocodeNominatim(normalizedStrasse, numericPart, ort);
      
      if (reducedResult) {
        console.log(`ERFOLG: Reduzierte Hausnummer funktioniert: ${strasse} ${numericPart}, ${ort}`);
        const resultObj = {
          coordinates: reducedResult,
          accuracy: 'approximate',
          source: 'nominatim-reduced',
          originalHausnr: hausnr,
          reducedHausnr: numericPart,
          isReduced: true
        };
        
        // Beide Versionen cachen
        cache[key] = resultObj;
        cache[reducedKey] = resultObj;
        
        return resultObj;
      }
      
      // Auch mit Originalstraßenname versuchen
      if (normalizedStrasse !== strasse) {
        const fallbackResult = await geocodeNominatim(strasse, numericPart, ort);
        
        if (fallbackResult) {
          console.log(`ERFOLG mit Original + reduziert: ${strasse} ${numericPart}, ${ort}`);
          const resultObj = {
            coordinates: fallbackResult,
            accuracy: 'approximate',
            source: 'nominatim-original-reduced',
            originalHausnr: hausnr,
            reducedHausnr: numericPart,
            isReduced: true
          };
          
          cache[key] = resultObj;
          return resultObj;
        }
      }
    }
    
    // Wenn immer noch nichts gefunden wurde...
    console.warn('Alle Geocoding-Strategien fehlgeschlagen für:', `${strasse} ${hausnr}, ${ort}`);
    return null;
  } catch (error) {
    console.error('Geocoding-Gesamtfehler:', error);
    return null;
  }
}

// 4) Farbige Map-Pins
const yellowPin = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const bluePin = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

// 5) CSV-Import & Debugging
// Initialisierung der Benutzeroberfläche und Event-Handler
function setupUI() {
  setupFileInput();
}

// Funktion für Marker-Icons anpassen, um die grüne Markierung für besuchte Stops zu speichern
function getMarkerIcon(accuracy, source, hasHint, visited = false) {
  if (visited) return greenPin;
  if (hasHint) return yellowPin;
  return bluePin;
}

function setupFileInput() {
  const fileInput = document.getElementById('fileInput');
  
  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = e => {
      Papa.parse(e.target.result, {
        header: true,
        delimiter: ';',
        skipEmptyLines: true,
        encoding: 'UTF-8',
        error: err => {
          console.error('CSV-Parsing-Fehler:', err);
          // Versuche erneut mit UTF-8-BOM
          Papa.parse(e.target.result, {
            header: true,
            delimiter: ';',
            skipEmptyLines: true,
            encoding: 'UTF-8-BOM',
            error: err => console.error('CSV-Parsing-Fehler (2. Versuch):', err),
            complete: handleParsedResults
          });
        },
        complete: handleParsedResults
      });
    };
    
    // Mit expliziter UTF-8-Kodierung parsen
    function handleParsedResults(results) {
      if (!results.data || results.data.length === 0) {
        alert('Keine gültigen Daten in der CSV-Datei gefunden.');
        return;
      }
      
      // Bestehende Marker löschen
      if (routeControl) {
        map.removeControl(routeControl);
        routeControl = null;
      }
      
      // Bestehende Marker entfernen
      map.eachLayer(layer => {
        if (layer instanceof L.Marker && layer !== userMarker) {
          map.removeLayer(layer);
        }
      });
      
      // Marker-Referenzen für die Zuordnung
      const markerRefs = [];
      
      // Standardkoordinaten für Fallback, falls Geocoding fehlschlägt
      // (Zentrum von Deutschland als Fallback)
      const fallbackPosition = [49.5, 7.0];
      
      // Geocoding-Anfragen für jeden Datensatz
      const geocodePromises = results.data.map(async (row, index) => {
        // Default-Werte für unvollständige Zeilen
        const strasse = row.strasse || 'Unbekannte Straße';
        const hausnummer = row.hausnummer || '';
        const ort = row.ort || 'Unbekannter Ort';
        const hinweis = row.Hinweis || '';
        const hasHint = !!hinweis;
        const stopNumber = index + 1;
        
        try {
          // Suche nach Koordinaten, aber nur wenn alle notwendigen Felder vorhanden sind
          let position;
          if (row.strasse && row.hausnummer && row.ort) {
            const result = await geocode(strasse, hausnummer, ort);
            if (result) {
              // Verwende die gefundenen Koordinaten
              position = [result.lat, result.lon];
            } else {
              // Fallback-Position mit einem kleinen Versatz, damit sich die Marker nicht überlagern
              position = [
                fallbackPosition[0] + (Math.random() - 0.5) * 0.02, 
                fallbackPosition[1] + (Math.random() - 0.5) * 0.02
              ];
              console.warn(`Keine Koordinaten für ${strasse} ${hausnummer}, ${ort} gefunden. Verwende Fallback-Position.`);
            }
          } else {
            // Fallback-Position mit einem kleinen Versatz für unvollständige Adressen
            position = [
              fallbackPosition[0] + (Math.random() - 0.5) * 0.02, 
              fallbackPosition[1] + (Math.random() - 0.5) * 0.02
            ];
            console.warn('Unvollständige Adresse in Zeile', index + 1, '. Verwende Fallback-Position.');
          }
          
          // Marker hinzufügen mit Nummer (Amazon-style)
          const markerIcon = createNumberedMarker(stopNumber, hasHint, false);
          
          const marker = L.marker(position, {
            icon: markerIcon,
            draggable: false
          }).addTo(map);
          
          // Popup mit Adressinformationen
          const popupContent = `
            <div class="popup-content">
              <strong>Stop ${stopNumber}: ${strasse} ${hausnummer}</strong><br>
              ${ort}<br>
              ${hasHint ? `<hr><strong>Hinweis:</strong> ${hinweis}` : ''}
            </div>
          `;
          
          const popup = L.popup().setContent(popupContent);
          marker.bindPopup(popup);
          
          // Marker-Referenz speichern
          markerRefs.push({
            marker: marker,
            position: marker.getLatLng(),
            hasHint: hasHint,
            hintText: hinweis,
            street: strasse,
            houseNumber: hausnummer,
            city: ort,
            stopNumber: stopNumber
          });
          
          return marker;
        } catch (error) {
          console.error('Fehler beim Geocoding:', error);
          
          // Trotz Fehler einen Marker erstellen mit Fallback-Position
          const position = [
            fallbackPosition[0] + (Math.random() - 0.5) * 0.02, 
            fallbackPosition[1] + (Math.random() - 0.5) * 0.02
          ];
          
          const markerIcon = createNumberedMarker(stopNumber, hasHint, false);
          
          const marker = L.marker(position, {
            icon: markerIcon,
            draggable: false
          }).addTo(map);
          
          // Popup mit Adressinformationen und Fehlerhinweis
          const popupContent = `
            <div class="popup-content">
              <strong>Stop ${stopNumber}: ${strasse} ${hausnummer}</strong><br>
              ${ort}<br>
              <span style="color:red;">Koordinaten konnten nicht gefunden werden</span><br>
              ${hasHint ? `<hr><strong>Hinweis:</strong> ${hinweis}` : ''}
            </div>
          `;
          
          const popup = L.popup().setContent(popupContent);
          marker.bindPopup(popup);
          
          // Marker-Referenz speichern
          markerRefs.push({
            marker: marker,
            position: marker.getLatLng(),
            hasHint: hasHint,
            hintText: hinweis,
            street: strasse,
            houseNumber: hausnummer,
            city: ort,
            stopNumber: stopNumber
          });
          
          return marker;
        }
      });
      
      // Alle Geocoding-Anfragen abwarten
      Promise.all(geocodePromises).then(markers => {
        // Null-Werte entfernen (sollte eigentlich nicht mehr vorkommen)
        const validMarkers = markers.filter(marker => marker !== null);
        
        // Karte auf alle Marker zentrieren
        if (validMarkers.length > 0) {
          const markerGroup = L.featureGroup(validMarkers);
          map.fitBounds(markerGroup.getBounds().pad(0.1));
        }
        
        // Speichere alle Marker für die Routenführung
        stopMarkers = markerRefs.map(ref => {
          return {
            marker: ref.marker,
            position: ref.position,
            visited: false,
            hasHint: ref.hasHint,
            hintText: ref.hintText,
            street: ref.street,
            houseNumber: ref.houseNumber,
            city: ref.city,
            stopNumber: ref.stopNumber
          };
        });

        // Route-Button zur Karte hinzufügen
        const routeButton = L.control({ position: 'topright' });
        routeButton.onAdd = () => {
          const btn = L.DomUtil.create('button', 'route-button');
          btn.id = 'route-btn';
          btn.textContent = '🚗 Route starten';
          btn.title = 'Route zu allen Stops anzeigen';
          btn.style.marginBottom = '10px';
          L.DomEvent.on(btn, 'click', e => {
            L.DomEvent.stopPropagation(e);
            toggleRouteNavigation();
          });
          return btn;
        };
        routeButton.addTo(map);

        // Next-Stop-Button zur Karte hinzufügen
        const nextStopButton = L.control({ position: 'topright' });
        nextStopButton.onAdd = () => {
          const btn = L.DomUtil.create('button', 'next-stop-button');
          btn.id = 'next-stop-btn';
          btn.textContent = '⏭️ Nächster Stop';
          btn.title = 'Zum nächsten Stop navigieren';
          btn.style.marginBottom = '10px';
          btn.style.display = 'none'; // Versteckt, bis Navigation aktiv ist
          L.DomEvent.on(btn, 'click', e => {
            L.DomEvent.stopPropagation(e);
            if (isNavigating && currentRouteIndex >= 0 && currentRouteIndex < stopMarkers.length) {
              markStopAsVisited(currentRouteIndex);
            }
          });
          return btn;
        };
        nextStopButton.addTo(map);
      });
    }
    
    reader.readAsText(file);
  });
}

// Neue Funktion zum Umschalten der Routennavigation
function toggleRouteNavigation() {
  if (!stopMarkers || stopMarkers.length === 0) {
    alert('Keine Stops vorhanden. Bitte zuerst eine CSV-Datei importieren.');
    return;
  }

  if (isNavigating) {
    // Navigation stoppen
    stopNavigation();
    document.getElementById('route-btn').textContent = '🚗 Route starten';
    document.getElementById('next-stop-btn').style.display = 'none';
    
    // Stop-Panel entfernen
    if (stopPanel) {
      stopPanel.remove();
      stopPanel = null;
    }
  } else {
    // Navigation starten
    startNavigation();
    document.getElementById('route-btn').textContent = '⏹️ Navigation stoppen';
    document.getElementById('next-stop-btn').style.display = 'block';
    
    // Stop-Panel erstellen
    createStopPanel();
  }
  
  isNavigating = !isNavigating;
}

// Funktion zum Starten der Navigation
function startNavigation() {
  // Sicherstellen, dass Tracking aktiv ist
  if (!tracking) {
    toggleTracking();
  }
  
  // Zurücksetzen des Besuchsstatus aller Marker
  stopMarkers.forEach(stop => {
    stop.visited = false;
    
    // Aktualisiere Marker mit nummerierten Icons
    const numberIcon = createNumberedMarker(stop.stopNumber, stop.hasHint, false);
    stop.marker.setIcon(numberIcon);
    
    // Adressinformationen hinzufügen
    stop.address = `${stop.street || ''} ${stop.houseNumber || ''}`.trim();
    stop.hint = stop.hasHint ? stop.hintText : '';
  });
  
  // Stop-Statistik zurücksetzen
  completedStops = 0;
  remainingStops = stopMarkers.length;
  
  // Routenoptimierung durchführen
  optimizeRoute();
}

// Neue Funktion: Optimiert die Route für alle Stops
function optimizeRoute() {
  if (!lastPosition || !stopMarkers || stopMarkers.length === 0) {
    return;
  }
  
  // Aktuelle Position als Startpunkt
  const start = lastPosition.latlng;
  
  // Vereinfachter Nearest-Neighbor-Algorithmus für Routenoptimierung
  let unvisitedStops = [...stopMarkers];
  let currentPosition = start;
  optimizedRoute = [];
  
  while (unvisitedStops.length > 0) {
    // Finde den nächsten Stop zur aktuellen Position
    let nearestIndex = 0;
    let minDistance = Infinity;
    
    for (let i = 0; i < unvisitedStops.length; i++) {
      const stop = unvisitedStops[i];
      const position = stop.position;
      
      // Berechnung der euklidischen Distanz (vereinfacht)
      const distance = Math.sqrt(
        Math.pow((position.lat - currentPosition[0]) * 111320, 2) + 
        Math.pow((position.lng - currentPosition[1]) * 111320 * Math.cos(currentPosition[0] * Math.PI / 180), 2)
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i;
      }
    }
    
    // Füge nächsten Stop zur optimierten Route hinzu
    const nextStop = unvisitedStops[nearestIndex];
    optimizedRoute.push(stopMarkers.indexOf(nextStop));
    
    // Aktualisiere aktuelle Position und entferne Stop aus der unbesuchten Liste
    currentPosition = [nextStop.position.lat, nextStop.position.lng];
    unvisitedStops.splice(nearestIndex, 1);
  }
  
  // Starte mit dem ersten Stop der optimierten Route
  if (optimizedRoute.length > 0) {
    currentRouteIndex = optimizedRoute[0];
    updateNextStop();
  }
}

// Funktion zum Stoppen der Navigation
function stopNavigation() {
  // Entferne Routenlayer
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  
  // Entferne weiße Konturlinie
  map.eachLayer(function(layer) {
    if (layer instanceof L.Polyline && 
        layer.options.color === '#FFFFFF' && 
        layer.options.weight === 4) {
      map.removeLayer(layer);
    }
  });
  
  // Entferne Start-Marker
  map.eachLayer(function(layer) {
    if (layer instanceof L.Marker && 
        layer.options.icon && 
        layer.options.icon.options.className === 'start-marker') {
      map.removeLayer(layer);
    }
  });
  
  // Entferne Routeninformationen
  const routeInfos = document.querySelectorAll('.route-info');
  routeInfos.forEach(info => {
    if (info.parentNode) {
      info.parentNode.removeChild(info);
    }
  });
  
  // Routenindex zurücksetzen
  currentRouteIndex = 0;
  optimizedRoute = [];
}

// Funktion zur Aktualisierung des nächsten Stops basierend auf dem aktuellen Standort
function updateNextStop() {
  if (!lastPosition || !stopMarkers || stopMarkers.length === 0) return;
  
  // Finde den nächsten unbesuchten Stop in der optimierten Route
  const unvisitedIndices = optimizedRoute.filter(index => !stopMarkers[index].visited);
  
  if (unvisitedIndices.length === 0) {
    alert('Alle Stops wurden besucht!');
    stopNavigation();
    return;
  }
  
  // Aktuellen Standort als Startpunkt verwenden
  const start = lastPosition.latlng;
  
  // Nächsten Stop aus der optimierten Route nehmen
  currentRouteIndex = unvisitedIndices[0];
  const nextStop = stopMarkers[currentRouteIndex];
  
  // Berechne und zeige die Route an
  calculateRoute(start, nextStop.position);
  
  // Stop-Panel aktualisieren
  updateStopPanel();
}

// Funktion zur Berechnung und Anzeige der Route
function calculateRoute(start, end) {
  // Zuerst alte Route entfernen, falls vorhanden
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  
  // Formatiere Start- und Endpunkte für die Routenberechnung
  const startPoint = L.latLng(start[0], start[1]);
  const endPoint = L.latLng(end.lat, end.lng);
  
  // OSRM-Service für die Routenberechnung verwenden
  fetch(`https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end.lng},${end.lat}?overview=full&geometries=polyline`)
    .then(response => response.json())
    .then(data => {
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        console.error('Routenberechnung fehlgeschlagen:', data);
        // Disable error alert
        // alert('Routenberechnung fehlgeschlagen. Bitte versuchen Sie es später erneut.');
        return;
      }
      
      // Route aus dem Ergebnis extrahieren
      const route = data.routes[0];
      const routeGeometry = polyline.decode(route.geometry);
      
      // Route auf der Karte anzeigen im Google Maps-Stil
      routeLayer = L.polyline(routeGeometry, {
        color: '#4285F4', // Google Maps Blau
        weight: 8,        // Dickere Linie
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round',
        // Effekt für besser sichtbare Route
        shadow: true,
        dashArray: null
      }).addTo(map);
      
      // Zweite Linie für Kontur-Effekt (Google Maps Stil)
      L.polyline(routeGeometry, {
        color: '#FFFFFF',
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);
      
      // Start- und Zielmarker hinzufügen
      const startMarker = L.marker(startPoint, {
        icon: L.divIcon({
          className: 'start-marker',
          html: '<div style="background-color:#4285F4;width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
      }).addTo(map);
      
      // Distanz- und Zeitinformationen anzeigen
      const distanceInKm = (route.distance / 1000).toFixed(1);
      const durationInMin = Math.round(route.duration / 60);
      
      // Karte so einstellen, dass sowohl Start als auch Ziel sichtbar sind
      const bounds = L.latLngBounds([startPoint, endPoint]);
      map.fitBounds(bounds, { padding: [50, 50] });
    })
    .catch(error => {
      console.error('Fehler bei der Routenberechnung:', error);
      // Disable error alert
      // alert('Routenberechnung fehlgeschlagen. Bitte versuchen Sie es später erneut.');
    });
}

// Funktion zum Markieren eines Stops als besucht
function markStopAsVisited(index) {
  if (index >= 0 && index < stopMarkers.length) {
    const stop = stopMarkers[index];
    stop.visited = true;
    
    // Aktualisiere Icon mit grünem Haken
    const visitedIcon = createNumberedMarker(stop.stopNumber, stop.hasHint, true);
    stop.marker.setIcon(visitedIcon);
    
    // Akustisches Signal für abgeschlossenen Stop
    const completionSound = new Audio('data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAAFAAAGUACEhISEhISEhISEq6urq6urq6urq8jIyMjIyMjIyMjI7u7u7u7u7u7u7u7///////////////8AAAA8TEFNRTMuMTAwBEgAAAAAAAAAABUgJAMGQQABmgAABlBZ53QSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    completionSound.play();
    
    // Aktualisiere die Stop-Statistik
    completedStops++;
    remainingStops--;
    updateStopPanel();
    
    // Zum nächsten Stop weitergehen
    updateNextStop();
  }
}

// Neue Funktion: Erstellt das Amazon-ähnliche Stop-Panel
function createStopPanel() {
  // Entferne vorhandenes Panel falls es existiert
  if (stopPanel) {
    stopPanel.remove();
  }
  
  // Erstelle neues Control-Panel
  stopPanel = L.control({ position: 'bottomleft' });
  
  stopPanel.onAdd = function(map) {
    const div = L.DomUtil.create('div', 'stop-panel');
    div.innerHTML = `
      <div class="panel-header">
        <span class="stop-title">Lieferung</span>
        <span class="stop-stats">${completedStops}/${stopMarkers.length} Stops</span>
      </div>
      <div class="current-stop-info"></div>
      <div class="stop-progress">
        <div class="progress-bar" style="width: ${(completedStops / stopMarkers.length) * 100}%"></div>
      </div>
    `;
    div.style.backgroundColor = 'white';
    div.style.padding = '10px';
    div.style.borderRadius = '4px';
    div.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
    div.style.width = '280px';
    div.style.maxWidth = '90vw';

    // Style für Header
    const header = div.querySelector('.panel-header');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '8px';
    header.style.fontWeight = 'bold';

    // Style für Fortschrittsbalken
    const progressBar = div.querySelector('.progress-bar');
    progressBar.style.backgroundColor = '#1E88E5';
    progressBar.style.height = '4px';
    progressBar.style.transition = 'width 0.3s';

    const progressContainer = div.querySelector('.stop-progress');
    progressContainer.style.backgroundColor = '#E0E0E0';
    progressContainer.style.height = '4px';
    progressContainer.style.marginTop = '10px';
    
    return div;
  };
  
  stopPanel.addTo(map);
  updateStopPanel();
}

// Neue Funktion: Aktualisiert das Stop-Panel mit aktuellen Informationen
function updateStopPanel() {
  if (!stopPanel) return;
  
  const panelElement = document.querySelector('.stop-panel');
  if (!panelElement) return;
  
  const statsElement = panelElement.querySelector('.stop-stats');
  statsElement.textContent = `${completedStops}/${stopMarkers.length} Stops`;
  
  const progressBar = panelElement.querySelector('.progress-bar');
  progressBar.style.width = `${(completedStops / stopMarkers.length) * 100}%`;
  
  const currentStopInfo = panelElement.querySelector('.current-stop-info');
  
  if (currentRouteIndex >= 0 && currentRouteIndex < stopMarkers.length) {
    const currentStop = stopMarkers[currentRouteIndex];
    const stopAddressText = `${currentStop.address || 'Adresse'} ${currentStop.hint ? '- ' + currentStop.hint : ''}`;
    
    currentStopInfo.innerHTML = `
      <div class="stop-number">Stop ${currentRouteIndex + 1}</div>
      <div class="stop-address">${stopAddressText}</div>
    `;
    
    // Style für Stop Info
    const stopNumber = currentStopInfo.querySelector('.stop-number');
    stopNumber.style.fontWeight = 'bold';
    stopNumber.style.fontSize = '16px';
    stopNumber.style.color = '#1E88E5';
    stopNumber.style.marginBottom = '4px';
    
    const stopAddressElement = currentStopInfo.querySelector('.stop-address');
    stopAddressElement.style.fontSize = '14px';
  } else {
    currentStopInfo.innerHTML = `<div class="no-stops">Keine aktiven Stops</div>`;
  }
}

// Polyline-Decoder für OSRM-Routen
// Füge diese Funktion deinem Code hinzu
const polyline = {
  decode: function(str, precision) {
    var index = 0,
        lat = 0,
        lng = 0,
        coordinates = [],
        shift = 0,
        result = 0,
        byte = null,
        latitude_change,
        longitude_change,
        factor = Math.pow(10, precision || 5);

    // Coordinates have variable length when encoded, so just keep
    // track of whether we've hit the end of the string. In each
    // loop iteration, a single coordinate is decoded.
    while (index < str.length) {
      // Reset shift, result, and byte
      byte = null;
      shift = 0;
      result = 0;

      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

      shift = result = 0;

      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

      lat += latitude_change;
      lng += longitude_change;

      coordinates.push([lat / factor, lng / factor]);
    }

    return coordinates;
  }
};

// Initialisierung beim Laden der Seite
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupUI();
  
  // Wake Lock anfordern, um den Bildschirm aktiv zu halten
  requestWakeLock();
  
  // Event-Listener für Sichtbarkeitsänderungen (Tab-Wechsel, App-Minimierung)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('App wieder sichtbar - Starte Geolocation neu');
      // Stoppe vorhandene Tracking-Session und starte neu
      stopTracking();
      startTracking();
      
      // Wake Lock erneut anfordern, wenn die App wieder sichtbar wird
      requestWakeLock();
    } else {
      // Optional: Wake Lock freigeben, wenn die App nicht sichtbar ist
      // releaseWakeLock(); // Auskommentiert, damit der Bildschirm auch im Hintergrund an bleibt
    }
  });
  
  // Zusätzlicher Event-Listener für mobile Geräte (Page Show/Hide Events)
  window.addEventListener('pageshow', () => {
    console.log('Seite neu angezeigt - Starte Geolocation neu');
    stopTracking();
    startTracking();
    
    // Wake Lock erneut anfordern
    requestWakeLock();
  });
  
  // Bei Wiederherstellung aus dem Hintergrund (für iOS Safari)
  window.addEventListener('focus', () => {
    console.log('Fenster erhält Fokus - Starte Geolocation neu');
    stopTracking();
    startTracking();
    
    // Wake Lock erneut anfordern
    requestWakeLock();
  });
  
  // Bei Schließen der Seite Wake Lock freigeben
  window.addEventListener('beforeunload', () => {
    releaseWakeLock();
  });
});

// Neuer grüner Pin
const greenPin = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

// Funktion zum Anfordern des Wake Locks, um den Bildschirm aktiv zu halten
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      // Fordere den Wake Lock an
      wakeLock = await navigator.wakeLock.request('screen');
      
      // Event-Listener für den Fall, dass der Wake Lock freigegeben wird
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
    // Stille Behandlung, wenn Wake Lock nicht unterstützt wird
  } catch (err) {
    // Fehler still behandeln
  }
}

// Funktion zur Freigabe des Wake Locks
async function releaseWakeLock() {
  if (wakeLock) {
    try {
      await wakeLock.release();
      wakeLock = null;
    } catch (err) {
      // Fehler still behandeln
    }
  }
}