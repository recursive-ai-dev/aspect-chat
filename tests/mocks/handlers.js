import { http, HttpResponse } from 'msw';

export const handlers = [
  // Example handler for fetching models, will be extended as needed
  http.get('*/models', () => {
    return HttpResponse.json({
      data: [
        { id: 'gpt-4o' },
        { id: 'gpt-3.5-turbo' }
      ]
    });
  }),
];
