"use strict";

const GoogleSpreadsheet = require("google-spreadsheet");
const bluebird = require("bluebird");

// Google api key with access to maps and geocoding
const API_KEY = "";

// Google service account (spreadsheet should be shared with write access)
const SERVICE_ACCOUNT = {
  private_key: "",
  client_email: ""
};

// ID of the spreadsheet from URL
// Example spreadsheet at:
// https://docs.google.com/spreadsheets/d/13K8tJhXQmQ1iTswiBigd0s7lUtvuNInkCAFr4qSug6w
const SPREADSHEET_ID = `13K8tJhXQmQ1iTswiBigd0s7lUtvuNInkCAFr4qSug6w`;

const googleMapsClient = require("@google/maps").createClient({
  key: API_KEY,
  Promise: Promise
});

function bestAddr(options) {
  if (options.length > 1) {
    console.log("Choosing first option:", options[0].formatted_address);
    options.slice(1).forEach(opt => {
      console.log("* Alternative:", opt.formatted_address);
    });
  }
  return options[0];
}
async function fetchRows() {
  const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
  bluebird.promisifyAll(doc);

  await doc.useServiceAccountAuthAsync(SERVICE_ACCOUNT);
  const info = await doc.getInfoAsync();
  const worksheet = bluebird.promisifyAll(info.worksheets[0]);

  const cells = await worksheet.getCellsAsync({
    "min-row": 1,
    "max-row": 125,
    "return-empty": true,
    "max-col": 15
  });

  // Reconstruct all the rows
  const columns = {};
  const rows = [];
  for (const cell of cells) {
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
  }

  const updateCells = [];
  function setCell(cell, value) {
    cell.value = value;
    updateCells.push(cell);
  }

  const SF_BOUNDS = {
    south: 37.732201,
    west: -122.51681,
    north: 37.821658,
    east: -122.381396
  };

  const rv = await Promise.all(
    rows.map(async row => {
      if (row.Location.value === "" && row.Src.value === "") {
        if (row.Err.value !== "") {
          setCell(row.Err, "");
        }
      } else if (row.Src.value !== row.Location.value) {
        if (row.Location.value === "") {
          setCell(row.Addr, "");
          setCell(row.Lat, "");
          setCell(row.Lon, "");
          setCell(row.Src, row.Location.value);
          setCell(row.Err, "");
        } else {
          await googleMapsClient
            .geocode({
              address: row.Location.value,
              bounds: SF_BOUNDS
            })
            .asPromise()
            .then(response => {
              if (response.json.error_message) {
                throw new Error(JSON.stringify(response.json.error_message));
              } else if (response.json.results.length === 0) {
                throw new Error("No results found");
              }

              const addr = bestAddr(response.json.results);

              setCell(row.Addr, addr.formatted_address);
              setCell(row.Lat, addr.geometry.location.lat);
              setCell(row.Lon, addr.geometry.location.lng);
              setCell(row.Src, row.Location.value);
              setCell(row.Err, "");
            })
            .catch(err => {
              console.error("Geocode error:", err.toString());
              setCell(row.Addr, "");
              setCell(row.Lat, "");
              setCell(row.Lon, "");
              setCell(row.Src, "");
              setCell(row.Err, err.toString());
            });
        }
      }
      return {
        q: row.Q.value,
        location: row.Location.value,
        lat: row.Lat.value,
        lon: row.Lon.value,
        addr: row.Addr.value,
        owner: row.Owner.value,
        points: row.Pts.value,
        icon: row.Icon.value
      };
    })
  );

  if (updateCells.length) {
    console.log("Update", updateCells.length, "cells");
    await worksheet.bulkUpdateCellsAsync(updateCells);
  }
  return rv;
}

module.exports = (req, res) => {
  fetchRows().then(rows => {
    res.end(`<!DOCTYPE html>
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
        <script src="./map.js"></script>
        <script
          src="https://maps.googleapis.com/maps/api/js?key=${API_KEY}&callback=initMap"
        ></script>
      </body>
    </html>`);
  });
};
