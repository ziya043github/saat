# Clock App Refactor TODO

## 1. Enhance City Search
- [x] Improve Nominatim API integration for small cities like Xınalıq
- [x] Ensure coordinates are fetched accurately for any city

## 2. Display City and Country Details
- [x] Update result section to show both city and country names
- [x] Modify selectCityByCoords to include country in display

## 3. Time Offset Calculation
- [x] Add function to calculate offset between user's local timezone and selected city's timezone
- [x] Display offset in format like "+4 saat" or "-2 saat"

## 4. Live Clock Mechanism
- [x] Ensure clock updates every second with setInterval
- [x] Format as HH:MM:SS dynamically

## 5. Error Handling
- [x] Add user-friendly "Şəhər tapılmadı" message for failed searches
- [x] Handle API errors gracefully

## 6. UI/UX Improvements
- [x] Modernize CSS for dark theme
- [x] Improve mobile responsiveness
- [x] Enhance overall design
