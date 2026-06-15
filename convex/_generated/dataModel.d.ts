/* eslint-disable */
/**
 * Generated data model types.
 *
 * THIS CODE IS GENERATED AUTOMATICALLY by `npx convex dev` / `npx convex codegen`.
 * Committed so the project typechecks without a Convex login. Do not edit by hand.
 */
import type {
	DataModelFromSchemaDefinition,
	DocumentByName,
	TableNamesInDataModel,
	SystemTableNames
} from 'convex/server';
import type { GenericId } from 'convex/values';
import schema from '../schema.js';

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;

export type Doc<TableName extends TableNamesInDataModel<DataModel>> = DocumentByName<
	DataModel,
	TableName
>;

export type Id<TableName extends TableNamesInDataModel<DataModel> | SystemTableNames> =
	GenericId<TableName>;
