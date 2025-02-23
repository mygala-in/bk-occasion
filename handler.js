const logger = require('./bk-utils/logger');
const access = require('./bk-utils/access');
const errors = require('./bk-utils/errors');
const constants = require('./bk-utils/constants');
const common = require('./bk-utils/common');
const rdsOccasions = require('./bk-utils/rds/rds.occasions.helper');
const rdsOUsers = require('./bk-utils/rds/rds.occasion.users.helper');
const snsHelper = require('./bk-utils/sns.helper');
// const rdsPosts = require('./bk-utils/rds/rds.posts.helper');

const { OCCASION_CONFIG } = constants;



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
  // await snsHelper.pushToSNS('timeline-bg-tasks', { service: 'timeline', component: 'post', action: 'add', data: { userId: decoded.id, weddingId: insertId, postId } });

  // TODO send an alert to indicate new wedding event was created
  request.pathParameters = { occasionId: insertId };

  return rdsOccasions.getOccasion(insertId);
}


async function invoke(event, context, callback) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
  try {
    const request = access.validateRequest(event, context);

    let resp = {};
    switch (request.resourcePath) {
      // case '/v1/list':
      //   resp = await getOccasion(request);
      //   break;

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
