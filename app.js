function setupFileInput() {
  document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return alert('Keine Datei ausgewählt.');

    // FileReader verwenden, um Umlaute korrekt zu verarbeiten
    const reader = new FileReader();
    
    reader.onload = function(event) {
      const csvData = event.target.result;
      
      // Zusätzliche Funktion zur Normalisierung von Strings mit Umlauten
      function normalizeString(str) {
        if (!str) return '';
        // Entfernt BOM (Byte Order Mark) falls vorhanden und trimmt Leerzeichen
        return str.replace(/^\uFEFF/, '').trim();
      }
      
      Papa.parse(csvData, {
        header: true,
        delimiter: "\u003b",  // Semikolon als Trennzeichen verwenden
        skipEmptyLines: true,
        encoding: "UTF-8",    // Explizite UTF-8-Kodierung
        transformHeader: function(header) {
          // Normalisiere Header
          return normalizeString(header);
        },
        transform: function(value, field) {
          // Normalisiere alle Feldwerte
          return normalizeString(value);
        },
        complete: async results => {
          console.log('Felder:', results.meta.fields);
          
          // Debugging: Zeige die ersten Zeilen der CSV-Datei
          console.log('Erste Zeilen:', results.data.slice(0, 3));
          
          let count = 0;
          let failedCount = 0;
          
          // Referenzen für Marker und deren IDs speichern
          const markerRefs = [];

          for (const row of results.data) {
            console.log('Zeile:', row);

            // Extrahiere die Adressdaten aus den richtigen Spalten
            // Unterstützt sowohl Kleinbuchstaben als auch unterschiedliche Schreibweisen
            const strasse = row['strasse'] || row['Strasse'] || row['straße'] || row['Straße'] || '';
            const hausnr = row['hausnummer'] || row['Hausnummer'] || row['hausnr'] || row['Hausnr'] || '';
            const ort = row['ort'] || row['Ort'] || '';
            const hinweis = row['hinweis'] || row['Hinweis'] || '';

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
        error: err => {
          console.error('PapaParse-Fehler:', err);
          alert('Fehler beim Einlesen der CSV-Datei: ' + err.message);
        }
      });
    };
    
    // Datei als Text mit UTF-8-Kodierung lesen
    reader.readAsText(file, 'UTF-8');
    
    // Fehlerbehandlung für FileReader
    reader.onerror = function() {
      console.error('FileReader-Fehler:', reader.error);
      alert('Fehler beim Lesen der Datei: ' + reader.error);
    };
  });
}