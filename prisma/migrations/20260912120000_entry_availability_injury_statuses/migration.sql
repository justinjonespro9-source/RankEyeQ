-- Extend weekly injury/status enum used by RankableEntry.availability.
ALTER TYPE "EntryAvailability" ADD VALUE 'IR';
ALTER TYPE "EntryAvailability" ADD VALUE 'PUP';
ALTER TYPE "EntryAvailability" ADD VALUE 'SUSPENDED';
ALTER TYPE "EntryAvailability" ADD VALUE 'FREE_AGENT';
