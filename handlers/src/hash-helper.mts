import {Tag as Tags} from '@aws-sdk/client-secrets-manager';

export interface AutoDumpTags {
  timezone?: string;
  startSchedule?: string;
}

export enum AutoDumpTag {
  START_SCHEDULE = 'autodump:start-schedule',
  TIMEZONE = 'autodump:timezone',
}

export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashTagsV1(tags: AutoDumpTags): string {
  return 'V1' + cyrb53(`${tags.timezone ?? ''}|${tags.startSchedule ?? ''}`);
}

function toCamelCase(str: string): string {
  str = (str.match(/[a-zA-Z0-9]+/g) || [])
    .map((x) => `${x.charAt(0).toUpperCase()}${x.slice(1)}`)
    .join('');
  return str.charAt(0).toLowerCase() + str.slice(1);
}

export function getTags(tags?: Tags[]): AutoDumpTags {
  if (!tags) {
    return {};
  }

  console.log(`getTags: tags is ${JSON.stringify(tags)}`);
  return tags.reduce((accumulatedTags: AutoDumpTags, tag) => {
    if (
      tag.Key &&
      tag.Value &&
      Object.values(AutoDumpTag).includes(tag.Key as AutoDumpTag)
    ) {
      const key = toCamelCase(tag.Key.replace('autodump:', ''));
      console.log(`getTags: key is ${key}`);
      if (key === 'startSchedule') {
        accumulatedTags.startSchedule = tag.Value.trim();
      }
      if (key === 'timezone') {
        accumulatedTags.timezone = tag.Value.trim();
      }
    }
    console.log(
      `getTags: accumulatedTags is ${JSON.stringify(accumulatedTags)}`,
    );
    return accumulatedTags;
  }, {} as AutoDumpTags);
}
