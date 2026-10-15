CREATE TABLE `AIAgentExecution` (
	`IdAIAgentExecution` bigint AUTO_INCREMENT NOT NULL,
	`ExecutionUUID` char(36) NOT NULL,
	`IdCompany` int,
	`IdChat` int,
	`IdProcessLine` int,
	`IdProcessLineFlow` int,
	`RequestedAgent` varchar(250) NOT NULL,
	`FinalAgent` varchar(250),
	`Message` longtext,
	`ExpectedOutputJSON` longtext,
	`RuntimeConfigJSON` longtext,
	`Success` char(1) NOT NULL DEFAULT 'N',
	`OutputJSON` longtext,
	`ErrorCode` varchar(100),
	`ErrorMessage` text,
	`OpenAITraceId` varchar(100),
	`StartedAt` datetime(3) NOT NULL,
	`FinishedAt` datetime(3),
	`DurationMs` int,
	CONSTRAINT `AIAgentExecution_IdAIAgentExecution` PRIMARY KEY(`IdAIAgentExecution`),
	CONSTRAINT `UQ_AIAgentExecution_UUID` UNIQUE(`ExecutionUUID`)
);
--> statement-breakpoint
CREATE TABLE `AIAgentExecutionLog` (
	`IdAIAgentExecutionLog` bigint AUTO_INCREMENT NOT NULL,
	`IdAIAgentExecution` bigint NOT NULL,
	`Sequence` int NOT NULL,
	`EventType` varchar(50) NOT NULL,
	`AgentName` varchar(250),
	`TargetAgentName` varchar(250),
	`ToolName` varchar(250),
	`InputJSON` longtext,
	`OutputJSON` longtext,
	`Status` varchar(50),
	`DurationMs` int,
	`ErrorMessage` text,
	`CreateDateTime` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `AIAgentExecutionLog_IdAIAgentExecutionLog` PRIMARY KEY(`IdAIAgentExecutionLog`)
);
--> statement-breakpoint
CREATE INDEX `IX_AIAgentExecution_ProcessLineFlow` ON `AIAgentExecution` (`IdProcessLineFlow`);--> statement-breakpoint
CREATE INDEX `IX_AIAgentExecution_Chat` ON `AIAgentExecution` (`IdChat`,`StartedAt`);--> statement-breakpoint
CREATE INDEX `IX_AIAgentExecution_OpenAITraceId` ON `AIAgentExecution` (`OpenAITraceId`);--> statement-breakpoint
CREATE INDEX `IX_AIAgentExecutionLog_Execution` ON `AIAgentExecutionLog` (`IdAIAgentExecution`,`Sequence`);