import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';

// Better Auth mounts its OAuth + session routes on the Convex HTTP router
// (served from the deployment's `.convex.site` domain).
const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

export default http;
