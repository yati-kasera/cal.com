import type { PrismaClient, WebhookTriggerEvents } from "@prisma/client";

import defaultPrisma from "@calcom/prisma";

export type GetSubscriberOptions = {
  userId: number;
  teamId?: number;
  eventTypeId: number;
  triggerEvent: WebhookTriggerEvents;
};

const getWebhooks = async (options: GetSubscriberOptions, prisma: PrismaClient = defaultPrisma) => {
  const { userId, eventTypeId, teamId } = options;

  const allWebhooks = await prisma.webhook.findMany({
    where: {
      OR: [
        {
          userId: !teamId ? userId : 0,
        },
        {
          eventTypeId,
        },
        {
          teamId,
        },
      ],
      AND: {
        eventTriggers: {
          has: options.triggerEvent,
        },
        active: {
          equals: true,
        },
      },
    },
    select: {
      id: true,
      userId: true,
      teamId: true,
      eventTypeId: true,
      subscriberUrl: true,
      payloadTemplate: true,
      appId: true,
      secret: true,
    },
  });
  return allWebhooks;
};

export default getWebhooks;
