// #######
// controllers need to be referenced in order to get crawled by the tsoa generator
import './controllers/orator/oratorController';
import './controllers/healthController';
// #######

import * as pino from 'pino';
import * as cors from 'kcors';
import * as Koa from 'koa';
import * as KoaRouter from 'koa-router';
import * as bodyParser from 'koa-bodyparser';
import * as compose from 'koa-compose';
import * as gzip from 'koa-compress';
import * as prometheus from 'prom-client';
import * as Boom from '@hapi/boom';
import * as path from 'path';
import * as http from 'http';
import { existsSync } from 'fs';
import { KoaSwaggerUiOptions } from 'koa2-swagger-ui';
type koa2SwaggerUiFunc = (config: Partial<KoaSwaggerUiOptions>) => Koa.Middleware;
// tslint:disable-next-line: no-var-requires // We actually have to do this for koa2-swagger-ui
const koaSwagger = require('koa2-swagger-ui') as koa2SwaggerUiFunc; // Read why I'm doing this here: https://github.com/scttcper/koa2-swagger-ui/issues/56#issuecomment-515208496
import { requestInterceptor } from './swaggerInterceptors';

import * as koaStatic from 'koa-static';

import * as MAKE_ME_LAST from './middleware/404-logger';
import { errorLogger } from './middleware/error-logger';
import { errorResponder } from './middleware/error-responder';
import { insertCorrelationId } from './middleware/request-id';
import { logRequest } from './middleware/request-logger';
import { myLogger } from './agnosticUtilities/myLogger';

import { RegisterRoutes } from './routes';
import { envVars } from './config/configInitiator';

process.on(
	'uncaughtException',
	pino.final(myLogger, (err, finalLogger) => {
		finalLogger.fatal(err, 'Uncaught Exception');
	}),
);

const app = new Koa();
const listenToAllHostNames = '0.0.0.0';
const specificHostname = envVars.get('MY_HOST_URL');
const PORT_THAT_WILL_WORK_WITH_SWAGGER_UI = 3000;
if (process.env.PORT && parseInt(process.env.PORT) !== PORT_THAT_WILL_WORK_WITH_SWAGGER_UI) {
	throw new Error(`The only port that will work with the swagger UI is ${PORT_THAT_WILL_WORK_WITH_SWAGGER_UI}`);
}
export const port = PORT_THAT_WILL_WORK_WITH_SWAGGER_UI;
app.use(bodyParser());
app.use(errorResponder);
app.use(errorLogger);
app.use(insertCorrelationId);
app.use(logRequest);
app.use(gzip());
app.use(cors());

// #######
// Registering the auto-generated routes from tsoa
const router = new KoaRouter();
RegisterRoutes(router);
app.use(router.routes()).use(router.allowedMethods());
// #######

const SWAGGER_DIR_TO_SERVE = path.join(__dirname, '..', 'staticFilesToBeServed');
const swaggerDocPath = path.join(SWAGGER_DIR_TO_SERVE, 'swagger.yaml');
if (process.env.NODE_ENV !== 'test' && !existsSync(swaggerDocPath)) {
    throw new Error(`Could not locate this file: ${swaggerDocPath}`);
}
app.use(koaStatic(SWAGGER_DIR_TO_SERVE));

const SWAGGER_UI_ROUTE = '/swagger';

const oauth2RedirectUrl = `http://${specificHostname}:${port}${SWAGGER_UI_ROUTE}`;
const runningUrl = specificHostname.includes('localhost')
    ? `http://${specificHostname}:${port}/`
    : `${specificHostname}/`;
const swaggerDocUrl = runningUrl + 'swagger.yaml';

app.use(
	koaSwagger({
		routePrefix: SWAGGER_UI_ROUTE, // host at /swagger instead of default /docs
		oauthOptions: {
			// as defined in https://github.com/swagger-api/swagger-ui/blob/master/docs/usage/oauth2.md
			clientId: envVars.get('OAUTH_CLIENT_ID'),
		},
		hideTopbar: true,
		swaggerOptions: {
			url: `http://${specificHostname}:${port}/swagger.yaml`,
			oauth2RedirectUrl: oauth2RedirectUrl,
			showRequestHeaders: true,
			jsonEditor: true,
			// tslint:disable-next-line: no-any // TODO: make an open source PR to update  @types/koa2-swagger-ui since this is actually supported via https://github.com/scttcper/koa2-swagger-ui/pull/41/files#
			requestInterceptor: requestInterceptor as any,
		},
	}),
);

app.use(MAKE_ME_LAST.fourOhFourLogger); // <-- seriously, if you put this before other middleware... that middleware will not be hit

const createAndRunServer = (): http.Server => {
	return app.listen(port, listenToAllHostNames, undefined, () => {
		myLogger.info(
			`App started. Listening at ${runningUrl} and if you'd like to access the swagger page please visit ${runningUrl}swagger`,
		);
	});
};

if (process.env.NODE_ENV !== 'test') {
	createAndRunServer();
}

export const getUnStartedApp = () => {
	if (process.env.NODE_ENV !== 'test') {
		throw new Error(
			'Since you were not running in test mode, then there will be no way to provide an unstarted application server',
		);
	}
	return app;
};
