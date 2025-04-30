// Globale Variablen für Geolocation und Karte
let watchId = null;
let userMarker = null;
let userCircle = null;
let tracking = true;
let lastPosition = null;
let positionHistory = [];
let map;

// 1) Leaflet & Geolocation-Setup
function initMap() {
  map = L.map('map').setView([49.5, 7.0], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap-Mitwirkende'
  }).addTo(map);

  // Genauigkeitsanzeige hinzufügen
  const accuracyInfo = L.control({ position: 'bottomleft' });
  accuracyInfo.onAdd = function() {
    const div = L.DomUtil.create('div', 'accuracy-info');
    div.innerHTML = '<div id="accuracy" style="background: white; padding: 5px; border-radius: 4px; display: inline-block;"></div>';
    return div;
  };
  accuracyInfo.addTo(map);
  
  // Standortverfolgung-Button hinzufügen
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
    timeout: 5000              // 5 Sekunden Timeout (schnellere Updates)
  };
  
  watchId = navigator.geolocation.watchPosition(
    position => {
      const { latitude, longitude, accuracy, heading, speed } = position.coords;
      const latlng = [latitude, longitude];
      
      // Position in Historie speichern für Glättung
      positionHistory.push({latlng, accuracy, timestamp: Date.now()});
      // Nur die letzten 5 Positionen behalten
      if (positionHistory.length > 5) positionHistory.shift();
      
      // Positionsglättung bei niedrigen Geschwindigkeiten
      let smoothedPosition = latlng;
      if (speed !== null && speed < 1 && positionHistory.length > 2) {
        // Gewichteter Durchschnitt der letzten Positionen
        const weightedPositions = positionHistory.map((p, i) => {
          const weight = (i + 1) / positionHistory.length;
          return [p.latlng[0] * weight, p.latlng[1] * weight];
        });
        
        smoothedPosition = [
          weightedPositions.reduce((sum, pos) => sum + pos[0], 0) / positionHistory.reduce((sum, _, i) => sum + (i + 1), 0),
          weightedPositions.reduce((sum, pos) => sum + pos[1], 0) / positionHistory.reduce((sum, _, i) => sum + (i + 1), 0)
        ];
      }
      
      // Karte auf aktuelle Position zentrieren, wenn Tracking aktiv
      if (tracking) {
        map.setView(smoothedPosition, 18);
      }
      
      // Marker für Benutzerposition aktualisieren oder erstellen
      if (!userMarker) {
        userMarker = L.marker(smoothedPosition, {
          icon: L.divIcon({
            className: 'user-marker',
            html: '<div class="position-dot"></div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11]
          }),
          rotationAngle: heading || 0,
          rotationOrigin: 'center center'
        }).addTo(map).bindPopup('Mein Standort');
      } else {
        userMarker.setLatLng(smoothedPosition);
        if (heading !== null) userMarker.setRotationAngle(heading);
      }
      
      // Genauigkeitskreis aktualisieren oder erstellen
      if (!userCircle) {
        userCircle = L.circle(smoothedPosition, {
          radius: accuracy * 0.1,
          color: '#4285F4',
          fillColor: '#4285F4',
          fillOpacity: 0.1,
          weight: 1
        }).addTo(map);
      } else {
        userCircle.setLatLng(smoothedPosition);
        userCircle.setRadius(accuracy * 0.2);
      }
      
      // Genauigkeitsanzeige aktualisieren
      document.getElementById('accuracy').innerHTML = `
        <strong>Genauigkeit:</strong> ${Math.round(accuracy)} m
        ${speed !== null ? `<br><strong>Geschwindigkeit:</strong> ${Math.round(speed * 3.6)} km/h` : ''}
      `;
      
      lastPosition = {latlng: smoothedPosition, accuracy, heading, speed};
    },
    error => {
      console.error('Geolocation Fehler:', error);
      alert(`Standortbestimmung fehlgeschlagen: ${error.message}`);
      stopTracking();
    },
    geoOptions
  );
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

// 2) Adress-Parsen mit Hausnummer (inkl. Buchstaben)
function parseAddress(combined) {
  const [addrPart, ort] = combined.split(',').map(s => s.trim());
  const match = addrPart.match(/^(.+?)\s+(\d+[a-zA-Z0-9\/\-]*)$/);
  if (match) {
    return { strasse: match[1], hausnr: match[2], ort };
  }
  const parts = addrPart.split(' ');
  const hausnr = parts.pop();
  return { strasse: parts.join(' '), hausnr, ort };
}

// 3) Google Maps Geocoding mit Fallback und Caching
const cache = {};
async function geocodeNominatim(strasse, hausnr, ort) {
  try {
    // Verbesserte Adressformatierung für bessere Ergebnisse, besonders für Hausnummern mit Buchstaben
    const formattedStreet = strasse.trim();
    const formattedHausnr = hausnr.trim(); // Hausnummer unverändert lassen (mit Buchstaben wie 9A)
    const formattedOrt = ort.trim();
    
    // Methode 1: Strukturierte Suche mit street und city Parameter
    const params = new URLSearchParams({ 
      format: 'json', 
      street: `${formattedStreet} ${formattedHausnr}`, 
      city: formattedOrt,
      country: 'Deutschland',  // Land explizit angeben
      limit: '1',
      addressdetails: '1',
      extratags: '1',         // Zusätzliche Tags für bessere Bewertung
      namedetails: '1'        // Namensdetails für bessere Identifikation
    });
    
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { 
      headers: { 
        'User-Agent': 'OberthalMap/1.0',
        'Accept-Language': 'de,de-DE'  // Spracheinstellung für bessere lokale Ergebnisse
      } 
    });
    
    const data = await res.json();
    
    if (data.length) {
      console.log('Nominatim Methode 1 erfolgreich:', data[0].display_name);
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
    
    // Methode 2: Fallback mit q-Parameter (freie Textsuche)
    console.log('Nominatim Methode 1 fehlgeschlagen, versuche Methode 2...');
    
    // Verbesserte Adressformatierung für freie Textsuche
    const formattedAddress = `${formattedStreet} ${formattedHausnr}, ${formattedOrt}, Deutschland`;
    
    const fallbackParams = new URLSearchParams({ 
      format: 'json', 
      q: formattedAddress,
      limit: '1',
      addressdetails: '1',
      extratags: '1'
    });
    
    const fallbackRes = await fetch(`https://nominatim.openstreetmap.org/search?${fallbackParams}`, { 
      headers: { 
        'User-Agent': 'OberthalMap/1.0',
        'Accept-Language': 'de,de-DE'
      } 
    });
    
    const fallbackData = await fallbackRes.json();
    
    if (fallbackData.length) {
      console.log('Nominatim Methode 2 erfolgreich:', fallbackData[0].display_name);
      return [parseFloat(fallbackData[0].lat), parseFloat(fallbackData[0].lon)];
    }
    
    // Methode 3: Spezielle Behandlung für Hausnummern mit Buchstaben
    console.log('Nominatim Methode 2 fehlgeschlagen, versuche Methode 3 (spezielle Behandlung für Hausnummern mit Buchstaben)...');
    
    // Prüfen, ob die Hausnummer Buchstaben enthält
    if (/[a-zA-Z]/.test(formattedHausnr)) {
      // Nur die numerischen Teile der Hausnummer verwenden
      const numericPart = formattedHausnr.match(/\d+/)[0];
      const specialParams = new URLSearchParams({ 
        format: 'json', 
        street: `${formattedStreet} ${numericPart}`, // Nur numerischer Teil der Hausnummer
        city: formattedOrt,
        country: 'Deutschland',
        limit: '3',
        addressdetails: '1'
      });
      
      const specialRes = await fetch(`https://nominatim.openstreetmap.org/search?${specialParams}`, { 
        headers: { 
          'User-Agent': 'OberthalMap/1.0',
          'Accept-Language': 'de,de-DE'
        } 
      });
      
      const specialData = await specialRes.json();
      
      if (specialData.length) {
        console.log('Nominatim Methode 3 erfolgreich (spezielle Behandlung für Hausnummern mit Buchstaben):', specialData[0].display_name);
        return [parseFloat(specialData[0].lat), parseFloat(specialData[0].lon)];
      }
    }
    
    // Methode 4: Letzte Chance mit alternativer Formatierung (nur Straße)
    console.log('Nominatim Methode 3 fehlgeschlagen, versuche Methode 4...');
    
    // Alternative Formatierung ohne Hausnummer, falls diese das Problem ist
    const altParams = new URLSearchParams({ 
      format: 'json', 
      street: formattedStreet,  // Nur Straße ohne Hausnummer
      city: formattedOrt,
      country: 'Deutschland',
      limit: '5',              // Mehr Ergebnisse für bessere Chance
      addressdetails: '1'
    });
    
    const altRes = await fetch(`https://nominatim.openstreetmap.org/search?${altParams}`, { 
      headers: { 
        'User-Agent': 'OberthalMap/1.0',
        'Accept-Language': 'de,de-DE'
      } 
    });
    
    const altData = await altRes.json();
    
    if (altData.length) {
      console.log('Nominatim Methode 4 erfolgreich (ohne Hausnummer):', altData[0].display_name);
      return [parseFloat(altData[0].lat), parseFloat(altData[0].lon)];
    }
    
    console.warn('Alle Nominatim-Methoden fehlgeschlagen für:', formattedAddress);
    return null;
  } catch (error) {
    console.error('Nominatim Geocoding-Fehler:', error);
    return null;
  }
}

// Geocoding mit Google Maps API (primär) und Fallbacks
async function geocode(strasse, hausnr, ort) {
  // Cache-Schlüssel erstellen und prüfen
  const key = `${strasse}|${hausnr}|${ort}`;
  if (cache[key]) return cache[key];

  // Status-Popup ENTFERNT

  try {
    // 1. Google Maps Geocoding (beste Qualität)
    const GOOGLE_API_KEY = 'DEIN_API_KEY'; // Hier deinen API-Schlüssel eintragen
    if (GOOGLE_API_KEY && GOOGLE_API_KEY !== 'DEIN_API_KEY') {
      // Verbesserte Adressformatierung für Google, besonders für Hausnummern mit Buchstaben
      // Hausnummer wird unverändert übernommen (mit Buchstaben wie 9A)
      const formattedAddress = `${strasse} ${hausnr}, ${ort}, Deutschland`;
      const address = encodeURIComponent(formattedAddress);
      
      // Zusätzliche Parameter für präzisere Ergebnisse
      const params = new URLSearchParams({
        address: formattedAddress,
        key: GOOGLE_API_KEY,
        language: 'de',           // Spracheinstellung für bessere lokale Ergebnisse
        region: 'de',             // Region auf Deutschland beschränken
        components: 'country:de'  // Nur Ergebnisse aus Deutschland
      });
      
      const url = `https://maps.googleapis.com/maps/api/geocode/json?${params}`;
      console.log('Google Geocode-Anfrage:', formattedAddress);
      
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.status === 'OK' && data.results.length) {
        const result = data.results[0];
        const loc = result.geometry.location;
        const accuracy = result.geometry.location_type;
        
        // Genauigkeitsinformationen speichern
        const coordinates = [loc.lat, loc.lng];
        const resultObj = {
          coordinates,
          accuracy,
          source: 'google'
        };
        
        cache[key] = resultObj;
        console.log(`Google Geocoding erfolgreich: ${accuracy}`);
        // map.closePopup(statusPopup); // ENTFERNT
        return resultObj;
      }
      console.warn('Google Geocoding fehlgeschlagen:', data.status);
    }
    
    // 2. Nominatim als Fallback (kostenlos, aber weniger genau)
    console.log('Versuche Nominatim als Fallback...');
    const nominatimResult = await geocodeNominatim(strasse, hausnr, ort);
    if (nominatimResult) {
      const resultObj = {
        coordinates: nominatimResult,
        accuracy: 'approximate',
        source: 'nominatim'
      };
      
      cache[key] = resultObj;
      // map.closePopup(statusPopup); // ENTFERNT
      return resultObj;
    }
    
    // 3. Weitere Fallbacks könnten hier hinzugefügt werden
    
    // Wenn keine Ergebnisse gefunden wurden
    // map.closePopup(statusPopup); // ENTFERNT
    return null;
  } catch (error) {
    console.error('Geocoding-Fehler:', error);
    // map.closePopup(statusPopup); // ENTFERNT
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

// Marker-Icons für Standard und Hinweise


// Funktion zur Auswahl des richtigen Markers basierend auf Hinweis
function getMarkerIcon(accuracy, source, hasHint) {
  // Wenn ein Hinweis vorhanden ist, gelber Pin, sonst blauer Pin
  if (hasHint) return yellowPin;
  return bluePin;
}

function setupFileInput() {
  document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return alert('Keine Datei ausgewählt.');

    Papa.parse(file, {
      header: true,
      delimiter: ';',  // Semikolon als Trennzeichen verwenden
      skipEmptyLines: true,
      complete: async results => {
        console.log('Felder:', results.meta.fields);
        
        // Debugging: Zeige die ersten Zeilen der CSV-Datei
        console.log('Erste Zeilen:', results.data.slice(0, 3));
        
        let count = 0;
        let failedCount = 0;
        
        // Zähler für Ergebnisse

        // Referenzen für Marker und deren IDs speichern
        const markerRefs = [];

        for (const row of results.data) {
          console.log('Zeile:', row);

          // Extrahiere die Adressdaten aus den richtigen Spalten
          const strasse = row['Strasse'] || '';
          const hausnr = row['Hausnummer'] || '';
          const ort = row['Ort'] || '';
          const hinweis = row['Hinweis'] || '';

          // Überspringe Zeilen ohne Straße oder Hausnummer
          if (!strasse || !hausnr) continue;

          console.log('Adresse:', strasse, hausnr, ort);

          // Geocoding mit verbesserter Methode
          const result = await geocode(strasse, hausnr, ort);

          if (!result) {
            console.warn('Kein Ergebnis für:', `${strasse} ${hausnr}, ${ort}`);
            failedCount++;
            continue;
          }

          // Extrahiere Koordinaten und Metadaten
          let coords, accuracy, source;

          if (Array.isArray(result)) {
            coords = result;
            accuracy = 'unknown';
            source = 'unknown';
          } else if (result.coordinates) {
            coords = result.coordinates;
            accuracy = result.accuracy || 'unknown';
            source = result.source || 'unknown';
          }

          count++;

          // Wähle den richtigen Marker basierend auf Genauigkeit und Hinweis
          const markerIcon = getMarkerIcon(accuracy, source, !!hinweis);

          // Eindeutige ID für den Schalter im Popup
          const markerId = `switch-${count}`;

          // Erstelle den Marker mit Popup inkl. Schalter
          const marker = L.marker(coords, { icon: markerIcon })
            .addTo(map)
            .bindPopup(
              `<strong>${strasse} ${hausnr}, ${ort}</strong>` +
              (hinweis ? `<br><em>Hinweis:</em> ${hinweis}` : '') +
              `<br><label style="display:inline-flex;align-items:center;margin-top:6px;">
                <input type="checkbox" id="${markerId}" style="margin-right:6px;"> Pin grün
              </label>`
            );

          // Speichere Marker-Referenz für spätere Manipulation
          markerRefs.push({ marker, markerId, hasHint: !!hinweis });
        }

        // Event-Listener für Checkboxen im Popup
        map.on('popupopen', function(e) {
          const popupNode = e.popup._contentNode;
          if (!popupNode) return;
          const input = popupNode.querySelector('input[type="checkbox"]');
          if (!input) return;
          const markerObj = markerRefs.find(obj => obj.markerId === input.id);
          if (!markerObj) return;
          input.addEventListener('change', function() {
            if (input.checked) {
              markerObj.marker.setIcon(greenPin);
            } else {
              // Ursprüngliches Icon wiederherstellen
              markerObj.marker.setIcon(markerObj.hasHint ? yellowPin : bluePin);
            }
          });
        });
        
        // Legende für Marker-Farben hinzufügen
        const legend = L.control({ position: 'bottomright' });
        legend.onAdd = function() {
          const div = L.DomUtil.create('div', 'info legend');
          div.style.backgroundColor = 'white';
          div.style.padding = '10px';
          div.style.borderRadius = '5px';
          div.style.boxShadow = '0 0 5px rgba(0,0,0,0.2)';
          
          div.innerHTML = '<h4 style="margin:0 0 5px 0">Marker-Legende</h4>';
          div.innerHTML += '<div><img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png" width="15"> Standard </div>';
          div.innerHTML += '<div><img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png" width="15"> Mit Hinweis</div>';
          div.innerHTML += '<div><img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png" width="15"> Zugestellt </div>';
          
          return div;
        };
        legend.addTo(map);

        // Einfache Zusammenfassung ohne Genauigkeitsstatistiken
        const popup = L.popup({ closeButton: false, autoClose: false, closeOnClick: false, maxWidth: 300 })
          .setLatLng(map.getCenter())
          .setContent(`
            <div style="text-align:center">
              <h3 style="margin:5px 0">Geocoding-Ergebnisse</h3>
              <strong>${count}</strong> Stops gefunden<br/>
              ${failedCount > 0 ? `<strong>${failedCount}</strong> Adressen nicht gefunden<br/>` : ''}
              
              <button id="ok-btn" style="margin-top:12px;padding:6px 12px;cursor:pointer;">
                OK
              </button>
            </div>`)
          .openOn(map);
        document.getElementById('ok-btn').addEventListener('click', () => {
          map.closePopup(popup);
        });
      },
      error: err => console.error('PapaParse-Fehler:', err)
    });
  });
}

// Initialisierung beim Laden der Seite
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupUI();
});

// Neuer grüner Pin
const greenPin = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});