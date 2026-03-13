// Embedded templates for `bettermcp init` scaffolding.
// Templates are inline strings to avoid runtime file I/O and bundling complexity.

export const SAMPLE_SPEC = `openapi: "3.0.3"
info:
  title: Petstore API
  version: "1.0.0"
  description: A sample Petstore API for bettermcp
servers:
  - url: https://petstore.example.com
paths:
  /pets:
    get:
      operationId: listPets
      summary: List all pets
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: integer
          description: Maximum number of pets to return
      responses:
        "200":
          description: A list of pets
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  properties:
                    id:
                      type: integer
                    name:
                      type: string
                    species:
                      type: string
    post:
      operationId: createPet
      summary: Create a new pet
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - name
              properties:
                name:
                  type: string
                species:
                  type: string
      responses:
        "201":
          description: Pet created
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: integer
                  name:
                    type: string
                  species:
                    type: string
  /pets/{petId}:
    get:
      operationId: getPet
      summary: Get a pet by ID
      parameters:
        - name: petId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: A single pet
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: integer
                  name:
                    type: string
                  species:
                    type: string
        "404":
          description: Pet not found
`

export const SERVER_FILE = `import { BetterMCP } from 'bettermcp'

const server = new BetterMCP()

await server.loadSpec('./petstore.yaml')
await server.start()
`

/** Sanitize a directory name into a valid npm package name. */
export function sanitizePackageName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9-_.~]/g, '-')
      .replace(/^[^a-z]/, 'x-$&')
    || 'bettermcp-app'
  )
}

export function generatePackageJson(dirName: string): string {
  const pkg = {
    name: sanitizePackageName(dirName),
    version: '1.0.0',
    type: 'module',
    engines: { node: '>=20' },
    scripts: {
      start: 'node server.js',
    },
    dependencies: {
      bettermcp: 'latest',
    },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

export const SCAFFOLDED_FILES = [
  { name: 'petstore.yaml', content: SAMPLE_SPEC },
  { name: 'server.js', content: SERVER_FILE },
  // package.json handled separately (needs directory name)
] as const
