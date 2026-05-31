export const jsonResponse = (value: unknown, init: ResponseInit = {}): Response => {
  return new Response(JSON.stringify(value), { status: init.status ?? 200, headers: { 'content-type': 'application/json' } })
}

export const textResponse = (value: string, init: ResponseInit = {}): Response => {
  const responseInit: ResponseInit = { status: init.status ?? 200 }
  if (init.headers) {
    responseInit.headers = init.headers
  }
  return new Response(value, responseInit)
}

export const makeTweetResult = (id: string, handle: string, text: string, media: unknown[] = []): unknown => ({
  rest_id: id,
  core: {
    user_results: {
      result: {
        rest_id: `u${id}`,
        legacy: { screen_name: handle, name: handle.toUpperCase() }
      }
    }
  },
  legacy: {
    full_text: text,
    created_at: 'Mon Jan 01 00:00:00 +0000 2024',
    reply_count: 1,
    retweet_count: 2,
    favorite_count: 3,
    quote_count: 4,
    conversation_id_str: id,
    extended_entities: { media }
  },
  views: { count: '5' }
})

export const timelineBody = (tweets: unknown[]): unknown => ({
  data: {
    home: {
      home_timeline_urt: {
        instructions: [{
          entries: [
            ...tweets.map((tweet, index) => ({
              entryId: `tweet-${index}`,
              content: { itemContent: { tweet_results: { result: tweet } } }
            })),
            { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: 'bottom-cursor' } },
            { entryId: 'cursor-top', content: { cursorType: 'Top', value: 'top-cursor' } }
          ]
        }]
      }
    }
  }
})

export const tweetDetailBody = (tweet: unknown, replies: unknown[]): unknown => ({
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [{
        entries: [
          { entryId: 'focal', content: { itemContent: { tweet_results: { result: tweet } } } },
          ...replies.map((reply, index) => ({ entryId: `reply-${index}`, content: { itemContent: { tweet_results: { result: reply } } } })),
          { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: 'reply-cursor' } }
        ]
      }]
    }
  }
})
