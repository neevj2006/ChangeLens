import type { CollectionSchema } from 'deepspace/schema'

export const watchesSchema: CollectionSchema = {
  name: 'changeLensWatches',
  ownerField: 'ownerId',
  columns: [
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'state', storage: 'text', interpretation: 'json', required: true },
  ],
  permissions: {
    anonymous: { read: false, create: false, update: false, delete: false },
    '*': { read: false, create: false, update: false, delete: false },
  },
}
