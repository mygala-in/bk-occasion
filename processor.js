const _ = require('underscore');
const logger = require('./bk-utils/logger');
const common = require('./bk-utils/common');
const errors = require('./bk-utils/errors');
const redis = require('./bk-utils/redis.helper');
const constants = require('./bk-utils/constants');
const snsHelper = require('./bk-utils/sns.helper');
const rdsPosts = require('./bk-utils/rds/rds.posts.helper');
const rdsLocs = require('./bk-utils/rds/rds.locations.helper');
const rdsOccasions = require('./bk-utils/rds/rds.occasions.helper');
const rdsOUsers = require('./bk-utils/rds/rds.occasion.users.helper');
const rdsOEvents = require('./bk-utils/rds/rds.occasion.events.helper');

async function deleteOccasion(message) {
  const { occasionId, userId } = message;
  logger.info('starting occasion delete ', message);

  const occasion = await rdsOccasions.getOccasion(occasionId);
  if (_.isEmpty(occasion)) errors.handleError(404, 'occasion not found');

  const events = await rdsOEvents.getEvents(occasionId);
  const eventIds = events.items.map((e) => e.id);
  logger.info('occasion associated event ids ', { eventIds });

  const locations = await rdsLocs.getParentLocationsIn(eventIds.map((id) => `event_${id}`));
  const locationIds = locations.items.map((l) => l.id);
  logger.info('event associated location ids ', { locationIds });

  const users = await rdsOUsers.getUsers(occasionId);
  const userIds = users.items.map((u) => u.userId);
  logger.info('occasion associated user ids ', { userIds });

  const posts = await rdsPosts.getParentPostIds([occasionId]);
  const postIds = posts.items;
  logger.info('occasion associated post ids ', { postIds });

  // * - step1 - delete occasion posts
  let tasks = [];
  tasks.push(rdsPosts.deletePosts(postIds));
  postIds.forEach((postId) => {
    tasks.push(redis.del(redis.transformKey(`post_${postId}_likes_count`)));
    tasks.push(redis.del(redis.transformKey(`post_${postId}_comments_count`)));
    // TODO: delete post likes & comments
    tasks.push(snsHelper.pushToSNS('post-bg-tasks', { service: 'timeline', component: 'post', action: 'delete', data: { postId, occasionId, userIds } }));
  });
  tasks.push(snsHelper.pushToSNS('asset-bg-tasks', { service: 'asset', component: 'post', action: 'delete', data: { parentIds: postIds.map((postId) => `post_${postId}`) } }));
  await Promise.all(tasks);
  logger.info('deleted occasion posts & post assets');

  // * - step2 - delete event locations
  tasks = [];
  tasks.push(rdsLocs.delLocations(locationIds));
  tasks.push(redis.del(redis.transformKey(`occasion_${occasionId}_locations`)));
  eventIds.forEach((eventId) => tasks.push(redis.del(redis.transformKey(`event_${eventId}_locations`))));
  await Promise.all(tasks);
  logger.info('deleted occasion locations');

  // * - step3 - delete events and event assets
  tasks = [];
  tasks.push(rdsOEvents.deleteEvents(eventIds));
  tasks.push(snsHelper.pushToSNS('asset-bg-tasks', { service: 'asset', component: 'event', action: 'delete', data: { parentIds: eventIds.map((eventId) => `event_${eventId}`) } }));
  await Promise.all(tasks);
  logger.info('deleted occasion events & event assets');

  // * - step4 - delete users
  tasks = [];
  tasks.push(rdsOUsers.deleteUsersIn(occasionId, userIds));
  tasks.push(snsHelper.pushToSNS('fcm', {
    service: 'notification',
    component: 'notification',
    action: 'new',
    data: {
      id: `${occasionId}`,
      type: 'default',
      title: 'Occasion update',
      subtitle: 'Occasion update',
      topic: common.getTopicName('occasion', occasionId),
      groupId: constants.APP_NOTIFICATIONS.channels.occasion,
      payload: { hidden: true, tasks: ['/occasion/delete'], params: { occasionId } },
    },
  }));
  await Promise.all(tasks);
  logger.info('deleted occasion users');

  // * - step5 - delete occasion, occasion timeline & occasion assets
  tasks = [];
  const key = redis.transformKey(`occasion_${occasionId}`);
  tasks.push(rdsOccasions.deleteOccasions([occasionId]));
  tasks.push(redis.del(`${key}_bg_count`));
  tasks.push(redis.del(`${key}_timeline`));
  tasks.push(redis.del(`${key}_assets`));
  tasks.push(redis.del(redis.transformKey(`occasion_${occasion.code}`)));
  tasks.push(snsHelper.pushToSNS('asset-bg-tasks', { service: 'asset', component: 'occasion', action: 'delete', data: { parentIds: [`occasion_${occasionId}`] } }));
  await Promise.all(tasks);
  logger.info('deleted occasion, occasion timeline & occasion assets');

  await snsHelper.pushToSNS('chat-bg-tasks', { service: 'chat', component: 'chat', action: 'delete', data: { chatId: `GC_${occasion.code}`, userId } });
  logger.info('sent occasion chat delete event');

  logger.info('completed occasion delete');
}


async function deleteEvent(message) {
  const { occasionId, eventId, userId } = message;

  const event = await rdsOEvents.getEvent(eventId);
  if (_.isEmpty(event)) errors.handleError(404, 'event not found');

  const locations = await rdsLocs.getLocationsByPId(`event_${eventId}`);
  const locationIds = locations.items.map((l) => l.id);
  logger.info('event associated location ids ', { locationIds });

  const tasks = [];
  tasks.push(rdsOEvents.deleteEvent(eventId));
  tasks.push(snsHelper.pushToSNS('asset-bg-tasks', { service: 'asset', component: 'event', action: 'delete', data: { parentIds: [eventId] } }));
  tasks.push(snsHelper.pushToSNS('notification-bg-tasks', { service: 'notification', component: 'event', action: 'delete', data: { occasionId, eventId } }));
  tasks.push(snsHelper.pushToSNS('email', { service: 'email', component: 'event', action: 'delete', data: { comment: 'event deleted', occasionId, eventId, userId } }));
  await Promise.all(tasks);

  logger.info('completed event delete');
}

async function sns(request) {
  logger.info('received occasion processor sns event');
  logger.info(JSON.stringify(request));
  try {
    const message = JSON.parse(request.Records[0].Sns.Message);
    logger.info(JSON.stringify(message));
    const { service, component, action, data } = message;
    if (service !== 'occasion') errors.handleError(400, `invalid service event ${service}, sent for occasion processor`);

    switch (component) {
      case 'occasion':
        switch (action) {
          case 'delete': return deleteOccasion(data);
          default:
        }
        break;
      case 'event':
        switch (action) {
          case 'delete': return deleteEvent(data);
          default:
        }
        break;
      default:
    }
    return { success: true };
  } catch (err) {
    logger.error(err);
    return { success: false };
  }
}


module.exports = {
  sns,
};
