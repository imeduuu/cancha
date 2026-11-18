import { Module } from "@nestjs/common";
import { LibraryModule } from "../library/library.module.js";
import { SaveCheckpointIndexes, saveCheckpointStoreFactoryProvider } from "./save-checkpoint-persistence.js";
import { SaveCheckpointsResolver } from "./save-checkpoints.resolver.js";
import { SaveCheckpointsService } from "./save-checkpoints.service.js";

@Module({
  imports: [LibraryModule],
  providers: [saveCheckpointStoreFactoryProvider, SaveCheckpointIndexes, SaveCheckpointsService, SaveCheckpointsResolver],
  exports: [saveCheckpointStoreFactoryProvider.provide],
})
export class SaveCheckpointsModule {}
