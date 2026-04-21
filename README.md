# Real Ad Blocker

To gotowe rozszerzenie do Chrome/Edge, które realnie blokuje sporo popularnych reklam i trackerów:

- statyczne reguły sieciowe `declarativeNetRequest`
- własna lista domen do blokowania
- import domen z tekstu/pliku (reguły i domeny)
- źródła list z auto‑aktualizacją (URL)
- biała lista stron, dla których blokowanie jest wyłączone
- pauza blokowania tylko dla bieżącej karty
- kosmetyczne ukrywanie widocznych boksów reklamowych
- szybki przełącznik ON/OFF w popupie
- licznik zablokowanych żądań na karcie, łącznie i per domena
- własne ikony rozszerzenia i ulepszony panel popup

## Jak uruchomić

1. Otwórz Chrome albo Edge.
2. Wejdź na `chrome://extensions` lub `edge://extensions`.
3. Włącz **Tryb dewelopera**.
4. Kliknij **Load unpacked / Załaduj rozpakowane**.
5. Wskaż folder projektu.

## Jak używać

- Kliknij ikonę rozszerzenia, żeby włączyć albo wyłączyć blokowanie.
- W popupie możesz dodać aktualną stronę do białej listy.
- W popupie możesz włączyć pauzę tylko dla aktualnej karty.
- Otwórz ustawienia, żeby dodać własne domeny reklamowe i własne wyjątki.
- W ustawieniach możesz importować domeny z tekstu/pliku i dodać URL-e źródeł list.
- W ustawieniach możesz uruchomić ręczną synchronizację źródeł lub auto‑sync co około 3h.
- Po zmianie stanu aktywnej karty następuje odświeżenie.

## Co już blokuje

Domyślnie projekt blokuje ponad 100 popularnych domen reklamowych i trackingowych, m.in. DoubleClick, Google Syndication, Taboola, Outbrain, Criteo, OpenX, Rubicon, Xandr, Revcontent, MGID, Media.net i podobne sieci reklamowe.

## Ograniczenia

To nie jest klon uBlock Origin z milionami reguł, ale jest to działające rozszerzenie MV3 z mocniejszym zestawem reguł, które można dalej rozbudować.
