import CLU from "command-line-usage";
import chalk from "chalk";
import { ApiResponseError, TwitterApi } from "twitter-api-v2";
import { Command, Param } from "@/lib/command";
import { loadTweetsJs } from "@/lib/data-loader";
import L from "@/lib/log";
import { CLEANWITH_TWEET_TEXT, sleep, TWEETSJS_FILE_PATH } from "@/common";
import { buildTwitterClient, sliceText } from "@/lib/tweet-utils";

export default class Clean extends Command {
  get helpMessage(): string {
    return CLU([
      {
        header: "Cleaner (`clean`)",
        content: [
          "Clean Tweets using Tweet Archive.",
          "\nThis command needs user access token secrets for accessing Twitter API, which can be obtained/saved (to file) by command {bold auth}.",
          "\nThis command will always perform dry run unless {underline --wet} parameter is specified, to prevent the user clean their Tweets by mistake.",
          "\n\n{red {bold CAUTION}: USE THIS COMMAND ON YOUR OWN RISK. DEVELOPER IS NOT RESPONSIBLE FOR ANY LOSS OR/AND DAMAGE OF YOUR DATA.}",
        ],
      },
      {
        header: "Parameters",
        optionList: this.availableParamsHelpDefinitions,
      },
    ]);
  }

  get availableParams() {
    return {
      "wet": new Param({
        name: "wet",
        help: {
          description: "Perform real cleaning job.",
          type: Boolean,
        },
      }),
    };
  }

  async doCommand(args: string[]): Promise<boolean> {
    if(!this.commandEntry(args)) return false;

    /* Constants / Variables */
    const wetModeEnabled = this.availableParams.wet.hasParam(args);
    let client: TwitterApi | null = null;

    /* Dry/Wet mode notices */
    if(wetModeEnabled) {
      L.w(this.name, chalk`{bold.underline Wet mode enabled}. {red THIS IS DESTRUCTIVE}, I HOPE YOU TO KNOW WHAT YOU'RE DOING.`);
      L.w(this.name, chalk`You have {bold 5 seconds} to cancel. Use "Ctrl+C" or just kill the process if you want to cancel.`);
      await sleep(5000);
    } else {
      L.i(this.name, "Dry mode enabled. No real cleaning job will be happened.");
    }

    /* Load Tweet list */
    L.nl();
    L.i(this.name, "Loading Tweet list from file...");
    const tweets = await loadTweetsJs(TWEETSJS_FILE_PATH);
    if(tweets) {
      L.i(this.name, chalk`Tweet list loaded. Total {bold ${tweets.length}} tweet(s).`);
    } else {
      L.e(this.name, `File "${TWEETSJS_FILE_PATH}" is not exist, or not available to use! Exiting.`);
      return true;
    }

    /* Load Twitter API client */
    if(wetModeEnabled) {
      L.nl();
      L.i(this.name, "Loading Twitter API client...");
      client = await buildTwitterClient();

      if(client) {
        L.i(this.name, chalk`Twitter API client loaded, logged in as {bold.underline @${(await client.currentUser()).screen_name}}`);
      } else {
        L.e(this.name, "Twitter API client not loaded or cannot be created! Exiting.");
        return true;
      }

      await sleep(2000);
    }

    /* Sleep a second(3 seconds on wet mode) to give the user last chance to cancel */
    L.nl();
    await sleep(1000);

    /* Real cleaning job */
    let deletedTweetCount = 0;
    for(let index = 0; index < tweets.length; index++) {
      const tweet = tweets[index];

      // // TEMP
      // if(parseInt(tweet.retweet_count) > 5) {
      //   L.i(this.name, `${tweet.id_str}: Retweet count > 5, skip, Text: "{bold ${sliceText(tweet.full_text, 30)}}"`);
      //   continue;
      // }

      if(wetModeEnabled) {
        if(client) {
          try {
            await client.v1.deleteTweet(tweet.id_str);
          } catch(error) {
            if(error instanceof ApiResponseError) {
              if(error.rateLimitError && error.rateLimit) {
                // Rate Limit Error
                let limitReset = error.rateLimit.reset;
                L.w(this.name, chalk`Hit the rate-limit! Tweet deleting API is limited to {underline ${error.rateLimit.limit} requests}.`);
                L.w(this.name, chalk`Rate limit for Tweet deleting API will be reset in ${limitReset} seconds.`);
                L.w(this.name, chalk`Cleaning job paused for rate-limit reset...`);

                while(limitReset > 0) {
                  await new Promise<void>((resolve) => {
                    Promise.resolve(sleep(1000));

                    process.stdout.clearLine(0);
                    process.stdout.cursorTo(0);
                    process.stdout.write((limitReset--).toString());
                    resolve();
                  });
                }

                L.nl();
                index--;
              } else if(error.code === 404) {
                L.w(this.name, chalk`{grey #${index + 1}} Tweet seems like deleted or not found. Skipping.  (Tweet ID: ${tweet.id_str})`);
              } else if(error.code === 403) {
                L.e(this.name, chalk`{grey #${index + 1}} Forbidden API access(HTTP 403)! Maybe you logged in with wrong account?  (Tweet ID: ${tweet.id_str})`);
                L.raw(error.errors);
              } else {
                L.e(this.name, chalk`{grey #${index + 1}} Unknown API error!   (Tweet ID: ${tweet.id_str})`);
                L.raw(error);
              }
            } else {
              L.e(this.name, chalk`{grey #${index + 1}} Unknown error!  (Tweet ID: ${tweet.id_str})`);
              L.raw(error);
            }
            
            continue;
          }
        }
      } else {
        // Faking communication delay, using sleep() with random duration(0.02s ~ 0.12s per Tweet)
        await sleep(Math.floor(Math.random() * 100 + 20));
      }

      L.i(this.name, chalk`{grey #${index + 1}} Deleted Tweet with ID: {bold ${tweet.id_str}}, Text: "{bold ${sliceText(tweet.full_text, 30)}}"`);
      deletedTweetCount++;
    }

    /* Leave `Clean With` Tweet */
    L.nl();
    L.i(this.name, "Leaving `Clean With` Tweet on logged in account...");
    L.i(this.name, "You are free to delete the Tweet once after it posted. You can cheer the developer up just by this Tweet!");
    try {
      if(wetModeEnabled && client) {
        await client.v1.tweet(CLEANWITH_TWEET_TEXT);
      }
      L.i(this.name, "`Clean With` Tweet posted!");
    } catch(error) {
      if(error instanceof ApiResponseError) {
        L.e(this.name, "Error caused while posting Tweet!");
        L.raw(error.errors);
      }
    }

    /* Cleaning job done */
    L.nl();
    L.i(this.name, chalk`Tweet cleaning job done! Deleted {bold ${deletedTweetCount}} Tweets out of ${tweets.length}.`);
    if(!wetModeEnabled) {
      L.w(this.name, "This command ran under dry mode, so no data has been deleted or altered.");
    }
    if(deletedTweetCount < 0) {
      L.w(this.name, "Looks like something went wrong, like you authenticated with different account, no Internet connection, or else. Please check and troubleshoot possible problems and run again!");
    }

    return true;
  }
}
