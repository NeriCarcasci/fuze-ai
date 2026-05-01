export type CloudTarget = 'hetzner' | 'scaleway' | 'ovh' | 'aws'

export type KmsProvider = 'aws-kms' | 'hcvault' | 'ionos-kms' | 'scw-kms'

export interface DeploymentSpec {
  readonly tenant_id: string
  readonly cloud: CloudTarget
  readonly region: string
  readonly model_providers: ReadonlyArray<string>
  readonly operator_wg_pubkeys: ReadonlyArray<string>
  readonly kms_provider: KmsProvider
  readonly kms_key_id: string
  readonly proxy_node_cidr?: string
  readonly model_provider_egress_cidrs?: ReadonlyArray<string>
  readonly sandbox_node_count?: number
  readonly packer_image_id?: string
}

export interface TerraformVarsOutput {
  readonly module: string
  readonly varsHcl: string
  readonly varsJson: string
}

export interface ModuleInventoryEntry {
  readonly name: string
  readonly cloud: CloudTarget
  readonly supportedRegions: ReadonlyArray<string>
  readonly euResidencyClaim: string
  readonly modulePath: string
}
