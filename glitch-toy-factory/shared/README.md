# Shared game constants

`factory-map.js` is shared by the authoritative server and Vite client. It defines the original factory's world dimensions, 7 room rectangles, connecting corridors, collision props, spawn points, movement speed/radius, and walkability checks. Keep gameplay-critical geometry and movement constraints centralized here so client visuals and server validation stay aligned.