import { GoogleSpreadsheet } from "google-spreadsheet";
import {
  Client as MapsClient,
  LatLngBounds,
} from "@googlemaps/google-maps-services-js";
import { JWT } from "google-auth-library";

import type { VercelRequest, VercelResponse } from "@vercel/node";

const GOOGLE_GEOCODE_API_KEY = process.env.GOOGLE_GEOCODE_API_KEY!;

const mapJsText =
  '"use strict";\n\nfunction initMap() {\n  const mapOptions = {\n    zoom: 10,\n    center: new google.maps.LatLng(0, 0)\n  };\n  const map = new google.maps.Map(document.getElementById("map"), mapOptions);\n  const bounds = new google.maps.LatLngBounds();\n  const infowindow = new google.maps.InfoWindow({\n    content: ""\n  });\n  for (const loc of window._LOCATIONS) {\n    if (loc.lat && loc.lon && loc.icon !== "none") {\n      const marker = createMarker(map, loc, infowindow);\n      bounds.extend(marker.position);\n    }\n  }\n  map.fitBounds(bounds);\n}\n\nfunction createMarker(map, loc, infowindow) {\n  // Icons\n  // https://stackoverflow.com/questions/8248077/google-maps-v3-standard-icon-shadow-names-equiv-of-g-default-icon-in-v2\n  const marker = new google.maps.Marker({\n    icon: `http://maps.google.com/mapfiles/ms/icons/${loc.icon}.png`,\n    position: {\n      lat: parseFloat(loc.lat),\n      lng: parseFloat(loc.lon)\n    },\n    map: map,\n    title: loc.q\n  });\n  google.maps.event.addListener(marker, "click", function() {\n    infowindow.setContent(\n      `<div>\n        <p><strong>${loc.q}: ${loc.answer || ""} [${loc.owner}]</strong></p>\n        <p>${loc.location}</p>\n        <p>${loc.addr}</p>\n      </div>`\n    );\n    infowindow.open(map, marker);\n  });\n  return marker;\n}\n';

// Initialize auth - see https://theoephraim.github.io/node-google-spreadsheet/#/guides/authentication
const serviceAccountAuth = new JWT({
  // env var values here are copied from service account credentials generated by google
  // see "Authentication" section in docs for more info
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// ID of the spreadsheet from URL
// Example spreadsheet at:
// https://docs.google.com/spreadsheets/d/13K8tJhXQmQ1iTswiBigd0s7lUtvuNInkCAFr4qSug6w
const SPREADSHEET_ID = `1icdQJ8zfyBqO1YETOqkqVKiU6iUcU0axyodNMowymhY`;

// For geocoding searches (only a suggestion)
const BOUNDS: LatLngBounds = {
  northeast: {
    lat: 37.821658,
    lng: -122.381396,
  },
  southwest: {
    lat: 37.732201,
    lng: -122.51681,
  },
};

const googleMapsClient = new MapsClient({});

function bestAddr(options) {
  if (options.length > 1) {
    console.log("Choosing first option:", options[0].formatted_address);
    options.slice(1).forEach((opt) => {
      console.log("* Alternative:", opt.formatted_address);
    });
  }
  return options[0];
}
async function fetchRows() {
  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  const worksheet = doc.sheetsByIndex[0];

  const rows = await worksheet.getRows({});

  /* Reconstruct all the rows
  const columns = {};
  const rows = [];
  for (const cell of cells) {
    console.log(cell);
    if (cell.row === 1) {
      columns[cell.value] = cell.col;
      columns[cell.col] = cell.value;
    } else {
      if (cell.row > rows.length + 1) {
        rows.push({});
      }
      if (columns[cell.col]) {
        rows[rows.length - 1][columns[cell.col]] = cell;
      }
    }
  }*/

  const rv = await Promise.all(
    rows.map(async (row) => {
      const location = row.get("Location") || "";
      const src = row.get("Src") || "";
      const err = row.get("Err") || "";
      if (location === "" && src === "") {
        if (err !== "") {
          row.set("Err", "");
          await row.save();
        }
      } else if (src !== location) {
        if (location === "") {
          row.set("Addr", "");
          row.set("Lat", "");
          row.set("Lon", "");
          row.set("Src", location);
          row.set("Err", "");
          await row.save();
        } else {
          const response = await googleMapsClient.geocode({
            params: {
              key: GOOGLE_GEOCODE_API_KEY,
              address: row.get("Location") || "",
              bounds: BOUNDS,
            },
          });

          try {
            console.log("geocode response", response);
            if (response.data.error_message) {
              throw new Error(JSON.stringify(response.data.error_message));
            } else if (response.data.results.length === 0) {
              throw new Error("No results found");
            }

            const addr = bestAddr(response.data.results);

            row.set("Addr", addr.formatted_address);
            row.set("Lat", addr.geometry.location.lat);
            row.set("Lon", addr.geometry.location.lng);
            row.set("Src", row.get("Location"));
            row.set("Err", "");
            await row.save();
          } catch (err) {
            if (!(err instanceof Error)) {
              throw new Error("Expected error object: " + err);
            }
            console.error("Geocode error:", err.toString());
            row.set("Addr", "");
            row.set("Lat", "");
            row.set("Lon", "");
            row.set("Src", "");
            row.set("Err", err.toString());
            await row.save();
          }
        }
      }
      return {
        q: row.get("Q"),
        location: row.get("Location"),
        lat: row.get("Lat"),
        lon: row.get("Lon"),
        addr: row.get("Addr"),
        owner: row.get("Owner"),
        points: row.get("Pts"),
        icon: row.get("Icon") || "tree",
      };
    })
  );
  return rv;
}

export const config = {};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rows = await fetchRows();
  res.setHeader("content-type", "text/html");
  res.send(`<!DOCTYPE html>
      <html>
        <head>
          <title>Simple Map</title>
          <meta name="viewport" content="initial-scale=1.0">
          <meta charset="utf-8">
          <style>
            /* Always set the map height explicitly to define the size of the div
            * element that contains the map. */
            #map {
              height: 100%;
            }
            /* Optional: Makes the sample page fill the window. */
            html, body {
              height: 100%;
              margin: 0;
              padding: 0;
            }
          </style>
        </head>
        <body>
          <div id="map"></div>
          <script>
            window._LOCATIONS = ${JSON.stringify(rows)};
          </script>
          <script>${mapJsText}</script>
          <script
            src="https://maps.googleapis.com/maps/api/js?key=${GOOGLE_GEOCODE_API_KEY}&callback=initMap"
          ></script>
        </body>
      </html>`);
}
