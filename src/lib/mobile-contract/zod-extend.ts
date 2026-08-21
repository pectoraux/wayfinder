// Wayfinder — P4.0 Zod OpenAPI Extension
//
// This file MUST be imported before any Zod schema that will be registered
// with the OpenAPI registry. It extends Zod with the .openapi() method.
//
// Import this file at the top of every mobile-contract module that defines
// Zod schemas used in the OpenAPI spec.

import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

extendZodWithOpenApi(z)

export { z }
