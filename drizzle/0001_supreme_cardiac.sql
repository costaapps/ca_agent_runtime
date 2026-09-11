CREATE TABLE `AIAgentSession` (
	`IdAIAgentSession` bigint AUTO_INCREMENT NOT NULL,
	`SessionUUID` char(36) NOT NULL,
	`IdCompany` int NOT NULL,
	`IdChat` int NOT NULL,
	`IdProcessLine` int NOT NULL,
	`RootAgent` varchar(250) NOT NULL,
	`Status` varchar(20) NOT NULL,
	`StartedAt` datetime(3) NOT NULL,
	`LastActivityAt` datetime(3) NOT NULL,
	`ClosedAt` datetime(3),
	CONSTRAINT `AIAgentSession_IdAIAgentSession` PRIMARY KEY(`IdAIAgentSession`),
	CONSTRAINT `UQ_AIAgentSession_UUID` UNIQUE(`SessionUUID`),
	CONSTRAINT `UQ_AIAgentSession_CompanyProcessLine` UNIQUE(`IdCompany`,`IdProcessLine`)
);
--> statement-breakpoint
CREATE TABLE `AIAgentSessionItem` (
	`IdAIAgentSessionItem` bigint AUTO_INCREMENT NOT NULL,
	`IdAIAgentSession` bigint NOT NULL,
	`Sequence` int NOT NULL,
	`ExecutionUUID` char(36),
	`ItemJSON` longtext NOT NULL,
	`CreateDateTime` datetime(3) NOT NULL,
	CONSTRAINT `AIAgentSessionItem_IdAIAgentSessionItem` PRIMARY KEY(`IdAIAgentSessionItem`),
	CONSTRAINT `UQ_AIAgentSessionItem_SessionSequence` UNIQUE(`IdAIAgentSession`,`Sequence`)
);
--> statement-breakpoint
ALTER TABLE `AIAgentExecution` ADD `IdAIAgentSession` bigint;--> statement-breakpoint
ALTER TABLE `AIAgentExecution` ADD `TurnUUID` char(36);--> statement-breakpoint
ALTER TABLE `AIAgentExecution` ADD `TurnInputJSON` longtext;--> statement-breakpoint
ALTER TABLE `AIAgentExecution` ADD `TurnPayloadHash` char(64);--> statement-breakpoint
ALTER TABLE `AIAgentExecution` ADD CONSTRAINT `UQ_AIAgentExecution_TurnUUID` UNIQUE(`TurnUUID`);--> statement-breakpoint
CREATE INDEX `IX_AIAgentSession_Status` ON `AIAgentSession` (`Status`);--> statement-breakpoint
CREATE INDEX `IX_AIAgentSessionItem_Session` ON `AIAgentSessionItem` (`IdAIAgentSession`,`Sequence`);--> statement-breakpoint
CREATE INDEX `IX_AIAgentSessionItem_Execution` ON `AIAgentSessionItem` (`ExecutionUUID`);