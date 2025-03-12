const logger = require('./bk-utils/logger');
const access = require('./bk-utils/access');
const errors = require('./bk-utils/errors');
const rdsRsvps = require('./bk-utils/rds/rds.occasion.rsvps.helper');


async function getRsvpList(request) {
  const { pathParameters } = request;
  const { parentId } = pathParameters;
  logger.info('getRsvpList request for parentId:', parentId);
  const rsvpList = await rdsRsvps.getRsvpList(parseInt(parentId, 10));
  return rsvpList;
}

async function getRsvp(request) {
  const { decoded, pathParameters } = request;
  const { parentId } = pathParameters;
  logger.info('getRsvp request', { parentId, userId: decoded.id });
  const rsvp = await rdsRsvps.getRsvp(parentId, decoded.id);
  if (!rsvp) {
    errors.handleError('RSVP not found');
  }
  return rsvp;
}

async function newOrUpdateRsvp(request) {
  const { decoded, pathParameters, queryStringParameters } = request;
  const { parentId } = pathParameters;
  const status = queryStringParameters && queryStringParameters.status;
  if (!status || !['Y', 'N', 'M'].includes(status)) {
    errors.handleError(400, 'invalid or missing rsvp status');
  }
  const rsvpObj = {
    parentId,
    userId: decoded.id,
    rsvp: status,
  };
  logger.info('newOrUpdateRsvp request', rsvpObj);
  await rdsRsvps.newOrUpdateRsvp(rsvpObj);
  return getRsvp(request);
}

async function deleteRsvp(request) {
  const { decoded, pathParameters } = request;
  const { parentId } = pathParameters;
  logger.info('deleteRsvp request', { parentId, userId: decoded.id });
  await rdsRsvps.deleteRsvp(parentId, decoded.id);
  return { success: true };
}



async function invoke(event, context, callback) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
  try {
    const request = access.validateRequest(event, context);

    let resp = {};
    switch (request.resourcePath) {
      case '/v1/{parentId}/rsvp':
        switch (request.httpMethod) {
          case 'GET': resp = await getRsvp(request);
            break;
          case 'PUT': resp = await newOrUpdateRsvp(request);
            break;
          case 'DELETE': resp = await deleteRsvp(request);
            break;
          default: errors.handleError(400, 'invalid request path');
        }
        break;
      case '/v1/{parentId}/rsvp/list':
        resp = await getRsvpList(request);
        break;
      default: errors.handleError(400, 'invalid request path');
    }

    context.callbackWaitsForEmptyEventLoop = false;
    logger.info('final response ', JSON.stringify(resp));
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
