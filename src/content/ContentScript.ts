import bind from "bind-decorator";
import { Options } from "options/ExtensionOptions";
import { RedditComment, RedditCommentThread, RedditPage } from "reddit/RedditPage";
import { OldRedditPage } from "reddit/OldRedditPage";
import { RedditCommentHighlighter } from "reddit/RedditCommentHighlighter";
import { OldRedditCommentHighlighter } from "reddit/OldRedditCommentHighlighter";
import { ThreadHistoryEntry } from "storage/ThreadHistory";
import { Actions } from "common/Actions";
import { onThreadVisitedEvent } from "common/Events";
import { extensionFunctionRegistry } from "common/Registries";

class ContentScript {
    private currentThread: RedditCommentThread | null = null;

    private constructor(
        private readonly reddit: RedditPage,
        private readonly highlighter: RedditCommentHighlighter
    ) {
        reddit.onThreadOpened.subscribe(this.onThreadVisited);
    }

    public static async start(): Promise<ContentScript> {
        const options = await extensionFunctionRegistry.invoke<void, Options>(Actions.GET_OPTIONS);
        let reddit: RedditPage;
        let highlighter: RedditCommentHighlighter;

        if (OldRedditPage.isSupported()) {
            reddit = new OldRedditPage();
            highlighter = new OldRedditCommentHighlighter(options);
        } else {
            throw "Failed to initialize content script. Reason: no suitable reddit page implementation found.";
        }

        return new ContentScript(reddit, highlighter);
    }

    public stop(): void {
        this.reddit.dispose();

        if (this.currentThread) {
            this.currentThread.dispose();
        }
    }

    @bind
    private async onThreadVisited(thread: RedditCommentThread): Promise<void> {
        if (this.currentThread) {
            this.currentThread.dispose();
        }

        this.currentThread = thread;

        if (thread.isAtRootLevel()) {
            // Only consider comment section viewed if at root level
            onThreadVisitedEvent.dispatch(thread.id);
        }

        thread.onCommentAdded.subscribe(this.highlightComments);

        await this.highlightComments(...thread.getAllComments());
    }

    @bind
    private async highlightComments(...comments: RedditComment[]): Promise<void> {
        if (!this.currentThread) {
            return;
        }

        const entry = await extensionFunctionRegistry.invoke<string, ThreadHistoryEntry | null>(
            Actions.GET_THREAD_BY_ID, this.currentThread.id);

        if (!entry) {
            // First time in comment section, no highlights
            return;
        }

        const timestamp = entry.timestamp * 1000;
        const user = this.reddit.getLoggedInUser();

        for (const comment of comments) {
            if (user && user === comment.author) {
                // Users own comment, skip
                continue;
            }

            if (!comment.time) {
                // Deleted comment, skip
                continue;
            }

            if (comment.time.valueOf() < timestamp) {
                // Comment already seen
                continue;
            }

            this.highlighter.highlightComment(comment);
        }
    }
}

/* This script is injected into every reddit page */

(async function entrypoint(): Promise<void> {
    try {
        await ContentScript.start()
    } catch (error) {
        console.log(error);
    }
})();