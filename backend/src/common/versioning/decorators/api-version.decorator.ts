import { SetMetadata } from '@nestjs/common';
import { ApiVersion } from '../version.enum';

export const API_VERSION_KEY = 'apiVersion';

/**
 * Decorator to mark a controller or route with specific API version(s)
 * @param versions - API version(s) that support this endpoint
 */
export const ApiVersions = (...versions: ApiVersion[]) =>
  SetMetadata(API_VERSION_KEY, versions);

/**
 * Decorator to mark an endpoint as deprecated
 * @param deprecatedSince - Version when the endpoint was deprecated
 * @param sunsetDate - Optional date when the endpoint will be removed
 * @param alternativeEndpoint - Optional alternative endpoint to use
 */
export const Deprecated = (
  deprecatedSince: ApiVersion,
  sunsetDate?: string,
  alternativeEndpoint?: string,
) =>
  SetMetadata('deprecated', {
    since: deprecatedSince,
    sunsetDate,
    alternativeEndpoint,
  });
