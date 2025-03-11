/* eslint-disable no-param-reassign */
/* eslint-disable no-await-in-loop */
const logger = require('./bk-utils/logger');
const rdsAssets = require('./bk-utils/rds/rds.assets.helper');
const rdsLocs = require('./bk-utils/rds/rds.locations.helper');
const rdsOEvents = require('./bk-utils/rds/rds.occasion.events.helper');

async function occasionExtras(occasionId, include) {
  const resp = {};
  let assets;
  let locations;
  logger.info(`fetching occasion extras :: occasion: ${occasionId} :: ${include}`);
  for (let i = 0; i < include.length; i += 1) {
    switch (include[i]) {
      case 'assets':
        resp.assets = await rdsAssets.getParentAssets(`occasion_${occasionId}`);
        break;
      case 'location':
        locations = await rdsLocs.getLocationsByPId(`occasion_${occasionId}`);
        [resp.location] = locations.items;
        break;
      case 'events':
        resp.events = await rdsOEvents.getEvents(occasionId);
        if (include.includes('assets')) {
          assets = await rdsAssets.getParentAssetsIn(
            resp.events.items.map((e) => `event_${e.id}`),
          );
          // eslint-disable-next-line no-loop-func
          resp.events.items.map((event) => {
            event.assets = { entity: 'collection', items: [], count: 0 };
            event.assets.items = assets.items.filter(
              (asset) => asset.eventId === event.id,
            );
            event.assets.count = event.assets.items.length;
            return event;
          });
        }
        if (include.includes('location')) {
          locations = await rdsLocs.getParentLocationsIn(
            resp.events.items.map((e) => `event_${e.id}`),
          );
          // eslint-disable-next-line no-loop-func
          resp.events.items.map((event) => {
            [event.location] = locations.items.filter(
              (l) => l.parentId === `event_${event.id}`,
            );
            return event;
          });
        }
        break;
      default:
    }
  }
  return resp;
}

async function eventExtras(eventId, include) {
  const resp = {};
  logger.info(`fetching occasion extras :: event: ${eventId} :: ${include}`);

  let locations;
  for (let i = 0; i < include.length; i += 1) {
    switch (include[i]) {
      case 'assets':
        resp.assets = await rdsAssets.getParentAssets(`event_${eventId}`);
        break;
      case 'location':
        locations = await rdsLocs.getLocationsByPId(`event_${eventId}`);
        [resp.location] = locations.items;
        break;
      default:
    }
  }
  return resp;
}

async function eventsExtras(occasionId, eventIds, include) {
  const resp = {};
  logger.info(`fetching event extras :: events: ${eventIds} :: ${include}`);
  for (let i = 0; i < include.length; i += 1) {
    switch (include[i]) {
      case 'assets':
        resp.assets = await rdsAssets.getParentAssetsIn(
          eventIds.map((id) => `event_${id}`),
        );
        break;
      case 'location':
        resp.locations = await rdsLocs.getParentLocationsIn(
          eventIds.map((id) => `event_${id}`),
        );
        break;
      default:
    }
  }
  return resp;
}

module.exports = {
  eventExtras,
  eventsExtras,
  occasionExtras,
};
