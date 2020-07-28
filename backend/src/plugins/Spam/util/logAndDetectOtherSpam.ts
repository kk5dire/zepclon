import { PluginData } from "knub";
import { SpamPluginType, RecentActionType } from "../types";
import { addRecentAction } from "./addRecentAction";
import { getRecentActionCount } from "./getRecentActionCount";
import { resolveMember, convertDelayStringToMS, stripObjectToScalars } from "src/utils";
import { MutesPlugin } from "src/plugins/Mutes/MutesPlugin";
import { CasesPlugin } from "src/plugins/Cases/CasesPlugin";
import { CaseTypes } from "src/data/CaseTypes";
import { clearRecentUserActions } from "./clearRecentUserActions";
import { LogType } from "src/data/LogType";

export async function logAndDetectOtherSpam(
  pluginData: PluginData<SpamPluginType>,
  type: RecentActionType,
  spamConfig: any,
  userId: string,
  actionCount: number,
  actionGroupId: string,
  timestamp: number,
  extraData = null,
  description: string,
) {
  pluginData.state.spamDetectionQueue = pluginData.state.spamDetectionQueue.then(async () => {
    // Log this action...
    addRecentAction(pluginData, type, userId, actionGroupId, extraData, timestamp, actionCount);

    // ...and then check if it trips the spam filters
    const since = timestamp - 1000 * spamConfig.interval;
    const recentActionsCount = getRecentActionCount(pluginData, type, userId, actionGroupId, since);

    if (recentActionsCount > spamConfig.count) {
      const member = await resolveMember(pluginData.client, pluginData.guild, userId);
      const details = `${description} (over ${spamConfig.count} in ${spamConfig.interval}s)`;

      if (spamConfig.mute && member) {
        const mutesPlugin = pluginData.getPlugin(MutesPlugin);
        const muteTime = spamConfig.mute_time ? convertDelayStringToMS(spamConfig.mute_time.toString()) : 120 * 1000;
        await mutesPlugin.muteUser(member.id, muteTime, "Automatic spam detection", {
          caseArgs: {
            modId: pluginData.client.user.id,
            extraNotes: [`Details: ${details}`],
          },
        });
      } else {
        // If we're not muting the user, just add a note on them
        const casesPlugin = pluginData.getPlugin(CasesPlugin);
        await casesPlugin.createCase({
          userId,
          modId: pluginData.client.user.id,
          type: CaseTypes.Note,
          reason: `Automatic spam detection: ${details}`,
        });
      }

      // Clear recent cases
      clearRecentUserActions(pluginData, RecentActionType.VoiceChannelMove, userId, actionGroupId);

      pluginData.state.logs.log(LogType.OTHER_SPAM_DETECTED, {
        member: stripObjectToScalars(member, ["user", "roles"]),
        description,
        limit: spamConfig.count,
        interval: spamConfig.interval,
      });
    }
  });
}