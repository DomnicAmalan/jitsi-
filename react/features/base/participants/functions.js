// @flow
import { getGravatarURL } from 'js-utils/avatar';

import { toState } from '../redux';

import { JitsiParticipantConnectionStatus } from '../lib-jitsi-meet';
import { MEDIA_TYPE, shouldRenderVideoTrack } from '../media';
import { getTrackByMediaTypeAndParticipant } from '../tracks';
import { createDeferred } from '../util';

import {
    JIGASI_PARTICIPANT_ICON,
    MAX_DISPLAY_NAME_LENGTH,
    PARTICIPANT_ROLE
} from './constants';
import { preloadImage } from './preloadImage';

declare var config: Object;
declare var interfaceConfig: Object;

/**
 * Temp structures for avatar urls to be checked/preloaded.
 */
const AVATAR_QUEUE = [];
const AVATAR_CHECKED_URLS = new Map();
/* eslint-disable arrow-body-style */
const AVATAR_CHECKER_FUNCTIONS = [
    participant => {
        return participant && participant.isJigasi ? JIGASI_PARTICIPANT_ICON : null;
    },
    participant => {
        return participant && participant.avatarURL ? participant.avatarURL : null;
    },
    participant => {
        return participant && participant.email ? getGravatarURL(participant.email) : null;
    }
];
/* eslint-enable arrow-body-style */

/**
 * Resolves the first loadable avatar URL for a participant.
 *
 * @param {Object} participant - The participant to resolve avatars for.
 * @returns {Promise}
 */
export function getFirstLoadableAvatarUrl(participant: Object) {
    const deferred = createDeferred();
    const fullPromise = deferred.promise
        .then(() => _getFirstLoadableAvatarUrl(participant))
        .then(src => {

            if (AVATAR_QUEUE.length) {
                const next = AVATAR_QUEUE.shift();

                next.resolve();
            }

            return src;
        });

    if (AVATAR_QUEUE.length) {
        AVATAR_QUEUE.push(deferred);
    } else {
        deferred.resolve();
    }

    return fullPromise;
}

/**
 * Returns local participant from Redux state.
 *
 * @param {(Function|Object|Participant[])} stateful - The redux state
 * features/base/participants, the (whole) redux state, or redux's
 * {@code getState} function to be used to retrieve the state
 * features/base/participants.
 * @returns {(Participant|undefined)}
 */
export function getLocalParticipant(stateful: Object | Function) {
    const participants = _getAllParticipants(stateful);

    return participants.find(p => p.local);
}

/**
 * Normalizes a display name so then no invalid values (padding, length...etc)
 * can be set.
 *
 * @param {string} name - The display name to set.
 * @returns {string}
 */
export function getNormalizedDisplayName(name: string) {
    if (!name || !name.trim()) {
        return undefined;
    }

    return name.trim().substring(0, MAX_DISPLAY_NAME_LENGTH);
}

/**
 * Returns participant by ID from Redux state.
 *
 * @param {(Function|Object|Participant[])} stateful - The redux state
 * features/base/participants, the (whole) redux state, or redux's
 * {@code getState} function to be used to retrieve the state
 * features/base/participants.
 * @param {string} id - The ID of the participant to retrieve.
 * @private
 * @returns {(Participant|undefined)}
 */
export function getParticipantById(
        stateful: Object | Function, id: string): ?Object {
    const participants = _getAllParticipants(stateful);

    return participants.find(p => p.id === id);
}

/**
 * Returns a count of the known participants in the passed in redux state,
 * excluding any fake participants.
 *
 * @param {(Function|Object|Participant[])} stateful - The redux state
 * features/base/participants, the (whole) redux state, or redux's
 * {@code getState} function to be used to retrieve the state
 * features/base/participants.
 * @returns {number}
 */
export function getParticipantCount(stateful: Object | Function) {
    return getParticipants(stateful).length;
}

/**
 * Returns a count of the known participants in the passed in redux state,
 * including fake participants.
 *
 * @param {(Function|Object|Participant[])} stateful - The redux state
 * features/base/participants, the (whole) redux state, or redux's
 * {@code getState} function to be used to retrieve the state
 * features/base/participants.
 * @returns {number}
 */
export function getParticipantCountWithFake(stateful: Object | Function) {
    return _getAllParticipants(stateful).length;
}

/**
 * Returns participant's display name.
 *
 * FIXME: Remove the hardcoded strings once interfaceConfig is stored in redux
 * and merge with a similarly named method in {@code conference.js}.
 *
 * @param {(Function|Object)} stateful - The (whole) redux state, or redux's
 * {@code getState} function to be used to retrieve the state.
 * @param {string} id - The ID of the participant's display name to retrieve.
 * @returns {string}
 */
export function getParticipantDisplayName(
        stateful: Object | Function,
        id: string) {
    const participant = getParticipantById(stateful, id);

    if (participant) {
        if (participant.name) {
            return participant.name;
        }

        if (participant.local) {
            return typeof interfaceConfig === 'object'
                ? interfaceConfig.DEFAULT_LOCAL_DISPLAY_NAME
                : 'me';
        }
    }

    return typeof interfaceConfig === 'object'
        ? interfaceConfig.DEFAULT_REMOTE_DISPLAY_NAME
        : 'Fellow Team Member';
}

/**
 * Returns the presence status of a participaupt associated with the passed id.
 *
 * @param {(Function|Object)} stateful - The (whole) redux state, or redux's
 * {@code getState} function to be used to retrieve the state.
 * @param {string} id - The id of the participant.
 * @returns {string} - The presence status.
 */
export function getParticipantPresenceStatus(
        stateful: Object | Function, id: string) {
    if (!id) {
        return undefined;
    }
    const participantById = getParticipantById(stateful, id);

    if (!participantById) {
        return undefined;
    }

    return participantById.presence;
}

/**
 * Selectors for getting all known participants with fake participants filtered
 * out.
 *
 * @param {(Function|Object|Participant[])} stateful - The redux state
 * features/base/participants, the (whole) redux state, or redux's
 * {@code getState} function to be used to retrieve the state
 * features/base/participants.
 * @returns {Participant[]}
 */
export function getParticipants(stateful: Object | Function) {
    return _getAllParticipants(stateful).filter(p => !p.isFakeParticipant);
}

/**
 * Returns the participant which has its pinned state set to truthy.
 *
 * @param {(Function|Object|Participant[])} stateful - The redux state
 * features/base/participants, the (whole) redux state, or redux's
 * {@code getState} function to be used to retrieve the state
 * features/base/participants.
 * @returns {(Participant|undefined)}
 */
export function getPinnedParticipant(stateful: Object | Function) {
    return _getAllParticipants(stateful).find(p => p.pinned);
}

/**
 * Returns array of participants from Redux state.
 *
 * @param {(Function|Object|Participant[])} stateful - The redux state
 * features/base/participants, the (whole) redux state, or redux's
 * {@code getState} function to be used to retrieve the state
 * features/base/participants.
 * @private
 * @returns {Participant[]}
 */
function _getAllParticipants(stateful) {
    return (
        Array.isArray(stateful)
            ? stateful
            : toState(stateful)['features/base/participants'] || []);
}

/**
 * Returns true if all of the meeting participants are moderators.
 *
 * @param {Object|Function} stateful -Object or function that can be resolved
 * to the Redux state.
 * @returns {boolean}
 */
export function isEveryoneModerator(stateful: Object | Function) {
    const participants = _getAllParticipants(stateful);

    for (const participant of participants) {
        if (participant.role !== PARTICIPANT_ROLE.MODERATOR) {
            return false;
        }
    }

    return true;
}

/**
 * Checks a value and returns true if it's a preloaded icon object.
 *
 * @param {?string | ?Object} icon - The icon to check.
 * @returns {boolean}
 */
export function isIconUrl(icon: ?string | ?Object) {
    return Boolean(icon) && typeof icon === 'object';
}

/**
 * Returns true if the current local participant is a moderator in the
 * conference.
 *
 * @param {Object|Function} stateful - Object or function that can be resolved
 * to the Redux state.
 * @param {?boolean} ignoreToken - When true we ignore the token check.
 * @returns {boolean}
 */
export function isLocalParticipantModerator(
        stateful: Object | Function,
        ignoreToken: ?boolean = false) {
    const state = toState(stateful);
    const localParticipant = getLocalParticipant(state);

    if (!localParticipant) {
        return false;
    }

    return (
        localParticipant.role === PARTICIPANT_ROLE.MODERATOR
        && (ignoreToken
                || !state['features/base/config'].enableUserRolesBasedOnToken
                || !state['features/base/jwt'].isGuest));
}

/**
 * Returns true if the video of the participant should be rendered.
 * NOTE: This is currently only used on mobile.
 *
 * @param {Object|Function} stateful - Object or function that can be resolved
 * to the Redux state.
 * @param {string} id - The ID of the participant.
 * @returns {boolean}
 */
export function shouldRenderParticipantVideo(stateful: Object | Function, id: string) {
    const state = toState(stateful);
    const participant = getParticipantById(state, id);

    if (!participant) {
        return false;
    }

    /* First check if we have an unmuted video track. */
    const videoTrack
        = getTrackByMediaTypeAndParticipant(state['features/base/tracks'], MEDIA_TYPE.VIDEO, id);

    if (!shouldRenderVideoTrack(videoTrack, /* waitForVideoStarted */ false)) {
        return false;
    }

    /* Then check if the participant connection is active. */
    const connectionStatus = participant.connectionStatus || JitsiParticipantConnectionStatus.ACTIVE;

    if (connectionStatus !== JitsiParticipantConnectionStatus.ACTIVE) {
        return false;
    }

    /* Then check if audio-only mode is not active. */
    const audioOnly = state['features/base/audio-only'].enabled;

    if (!audioOnly) {
        return true;
    }

    /* Last, check if the participant is sharing their screen and they are on stage. */
    const screenShares = state['features/video-layout'].screenShares || [];
    const largeVideoParticipantId = state['features/large-video'].participantId;
    const participantIsInLargeVideoWithScreen
        = participant.id === largeVideoParticipantId && screenShares.includes(participant.id);

    return participantIsInLargeVideoWithScreen;
}

/**
 * Resolves the first loadable avatar URL for a participant.
 *
 * @param {Object} participant - The participant to resolve avatars for.
 * @returns {?string}
 */
async function _getFirstLoadableAvatarUrl(participant) {
    for (let i = 0; i < AVATAR_CHECKER_FUNCTIONS.length; i++) {
        const url = AVATAR_CHECKER_FUNCTIONS[i](participant);

        if (url) {
            if (AVATAR_CHECKED_URLS.has(url)) {
                if (AVATAR_CHECKED_URLS.get(url)) {
                    return url;
                }
            } else {
                try {
                    const finalUrl = await preloadImage(url);

                    AVATAR_CHECKED_URLS.set(finalUrl, true);

                    return finalUrl;
                } catch (e) {
                    AVATAR_CHECKED_URLS.set(url, false);
                }
            }
        }
    }

    return undefined;
}
