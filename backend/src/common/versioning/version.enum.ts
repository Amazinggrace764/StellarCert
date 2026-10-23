export enum ApiVersion {
  V1 = '1',
  V2 = '2',
}

export const CURRENT_VERSION = ApiVersion.V1;
export const SUPPORTED_VERSIONS = [ApiVersion.V1];
export const DEPRECATED_VERSIONS: ApiVersion[] = [];
