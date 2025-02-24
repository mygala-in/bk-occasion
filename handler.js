const logger = require('./bk-utils/logger');
const access = require('./bk-utils/access');
const errors = require('./bk-utils/errors');
const constants = require('./bk-utils/constants');
const common = require('./bk-utils/common');
const rdsOccasions = require('./bk-utils/rds/rds.occasions.helper');
const rdsOUsers = require('./bk-utils/rds/rds.occasion.users.helper');
const snsHelper = require('./bk-utils/sns.helper');
const rdsUsers = require('./bk-utils/rds/rds.users.helper');
// const rdsPosts = require('./bk-utils/rds/rds.posts.helper');

const { OCCASION_CONFIG } = constants;

async function getOccasions(request) {
  const { decoded } = request;
  const { type } = request.queryStringParameters;
  logger.info({ type });
  const mJoins = await rdsOUsers.getOccasions(decoded.id);
  const mIds = mJoins.items.map((i) => i.occasionId);
  logger.info('occasion ids ', mIds);
  const vIds = mJoins.items.filter((i) => i.status === OCCASION_CONFIG.status.verified).map((i) => i.occasionId);
  logger.info('verified occasion ids ', vIds);
  if (type === 'occasions') {
    const gbIds = []; // groom & bride Ids
    const [occasions, bgcounts] = await Promise.all([rdsOccasions.getOccasionsIn(mIds), rdsOUsers.getBGCountsIn(mIds)]);
    logger.info('occasions ', JSON.stringify(occasions));
    logger.info('bgcounts ', JSON.stringify(bgcounts));
    for (let i = 0; i < occasions.count; i += 1) {
      const occasion = occasions.items[i];
      [occasion.ouser] = mJoins.items.filter((item) => item.occasionId === occasion.id);
      if (occasion.extras.brideId && !gbIds.includes(occasion.extras.brideId)) gbIds.push(occasion.extras.brideId);
      if (occasion.extras.groomId && !gbIds.includes(occasion.extras.groomId)) gbIds.push(occasion.extras.groomId);
      const bg = bgcounts.items.filter((item) => item.occasionId === occasion.id)[0];
      occasion.groomCount = bg.groomCount;
      occasion.brideCount = bg.brideCount;
      // no side count is added, referece:occasion_user_js
      occasion.noSideCount = bg.noSideCount;
      occasions.items[i] = occasion;
    }
    logger.info('groom & bride ids ', JSON.stringify(gbIds));
    const gbUsers = await rdsUsers.getUserFieldsIn(gbIds, [...constants.MINI_PROFILE_FIELDS, 'facebook', 'instagram', 'createdAt', 'updatedAt']);
    logger.info('gbUsers ', JSON.stringify(gbUsers));
    for (let i = 0; i < occasions.count; i += 1) {
      if (occasions.items[i].extras.brideId) [occasions.items[i].extras.bride] = gbUsers.items.filter((item) => item.id === occasions.items[i].extras.brideId);
      if (occasions.items[i].extras.groomId) [occasions.items[i].extras.groom] = gbUsers.items.filter((item) => item.id === occasions.items[i].extras.groomId);
    }
    return occasions;
  }

  // if (type === 'events') return rdsMEvents.getEventsIn(mIds);
  // if (type === 'assets') return rdsAssets.getParentAssetsIn(mIds.map((i) => `occasion_${i}`));
  if (type === 'users') {
    const oUsers = await rdsOUsers.getOUsersIn(vIds);
    const userIds = oUsers.items.map((user) => user.userId);
    const miniProfiles = await rdsUsers.getUserFieldsIn(userIds, constants.MINI_PROFILE_FIELDS);
    for (let i = 0; i < oUsers.count; i += 1) {
      [oUsers.items[i].user] = miniProfiles.items.filter((item) => item.id === oUsers.items[i].userId);
    }
    return oUsers;
  }
  return errors.handleError(400, 'invalid request type');
}


async function createNewOccasion(request) {
  const { body, decoded } = request;
  logger.info('new occasion request');

  // let isCodeExists = true;
  const code = common.genUid();
  // while (isCodeExists) {
  //   code = common.genUid();
  //   // eslint-disable-next-line no-await-in-loop
  //   const occasion = await rdsOccasions.getOccasion(code);
  //   // isCodeExists = occasion != null && occasion.entity === 'occasion';
  //   logger.info('occasion code exists check ', { code, isCodeExists });
  // }

  // * mObj - occasion object
  const mObj = { creatorId: decoded.id, title: body.title, note: body.note, code, url: body.url, fromTime: body.fromTime, locationId: body.locationId };
  const { insertId } = await rdsOccasions.newOccasion(mObj);

  // * muObj - occasion user object
  const muObj = { userId: decoded.id, occasionId: insertId, role: OCCASION_CONFIG.ROLES.admin.role, status: OCCASION_CONFIG.status.verified, side: body.side, verifierId: decoded.id };
  await Promise.all([
    rdsOUsers.newUser(muObj),
    // snsHelper.pushToSNS({ service: 'email', component: 'occation', action: 'new', data: { comment: 'new occasion created', id: insertId, ...mObj } }),
    snsHelper.pushToSNS('chat-bg-tasks', { service: 'chat', component: 'chat', action: 'new', data: { userId: decoded.id, username: decoded.username, name: body.title, chatId: `GC_${code}`, users: [decoded.id], type: 'occasion', isGroup: true } }),
  ]);

  // const postId = (await rdsPosts.insertPost({ userId: decoded.id, occationId: insertId, type: 'occasion.join', status: 'A' })).insertId;
  // await snsHelper.pushToSNS('timeline-bg-tasks', { service: 'timeline', component: 'post', action: 'add', data: { userId: decoded.id, occasionId: insertId, postId } });

  // TODO send an alert to indicate new occasion event was created
  request.pathParameters = { occasionId: insertId };

  return rdsOccasions.getOccasion(insertId);
}


async function invoke(event, context, callback) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
  try {
    const request = access.validateRequest(event, context);

    let resp = {};
    switch (request.resourcePath) {
      case '/v1/list':
        resp = await getOccasions(request);
        break;

      case '/v1/new':
        resp = await createNewOccasion(request);
        break;

      default: errors.handleError(400, 'invalid request path');
    }

    context.callbackWaitsForEmptyEventLoop = false;
    return callback(null, { statusCode: 200, headers, body: JSON.stringify(resp) });
  } catch (err) {
    context.callbackWaitsForEmptyEventLoop = false;
    logger.error('error processing api');
    logger.error(err);
    return callback(null, { headers, ...err });
  }
}


module.exports = {
  invoke,
};
