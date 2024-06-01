"use strict";

function initMap() {
  const mapOptions = {
    zoom: 10,
    center: new google.maps.LatLng(0, 0)
  };
  const map = new google.maps.Map(document.getElementById("map"), mapOptions);
  const bounds = new google.maps.LatLngBounds();
  const infowindow = new google.maps.InfoWindow({
    content: ""
  });
  for (const loc of window._LOCATIONS) {
    if (loc.lat && loc.lon && loc.icon !== "none") {
      const marker = createMarker(map, loc, infowindow);
      bounds.extend(marker.position);
    }
  }
  map.fitBounds(bounds);
}

function createMarker(map, loc, infowindow) {
  // Icons
  // https://stackoverflow.com/questions/8248077/google-maps-v3-standard-icon-shadow-names-equiv-of-g-default-icon-in-v2
  const marker = new google.maps.Marker({
    icon: `http://maps.google.com/mapfiles/ms/icons/${loc.icon}.png`,
    position: {
      lat: parseFloat(loc.lat),
      lng: parseFloat(loc.lon)
    },
    map: map,
    title: loc.q
  });
  google.maps.event.addListener(marker, "click", function() {
    infowindow.setContent(
      `<div>
        <p><strong>${loc.q}: ${loc.answer || ""} [${loc.owner}]</strong></p>
        <p>${loc.location}</p>
        <p>${loc.addr}</p>
      </div>`
    );
    infowindow.open(map, marker);
  });
  return marker;
}
