CREATE TABLE `users` (
  `user_id` char(36) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `status` enum('ACTIVE','DISABLED','LOCKED') NOT NULL DEFAULT 'ACTIVE',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_status` (`status`),
  KEY `idx_users_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `roles` (
  `role_id` char(36) NOT NULL,
  `role_code` varchar(50) NOT NULL,
  `role_name` varchar(100) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`role_id`),
  UNIQUE KEY `uq_roles_role_code` (`role_code`),
  UNIQUE KEY `uq_roles_role_name` (`role_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `customers` (
  `customer_id` char(36) NOT NULL,
  `user_id` char(36) DEFAULT NULL,
  `full_name` varchar(150) NOT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `customer_type` enum('REGISTERED','GUEST','MERGED') NOT NULL,
  `merged_into_customer_id` char(36) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`customer_id`),
  UNIQUE KEY `uq_customers_user_id` (`user_id`),
  KEY `idx_customers_phone` (`phone`),
  KEY `idx_customers_email` (`email`),
  KEY `idx_customers_merged_into` (`merged_into_customer_id`),
  CONSTRAINT `fk_customers_merged_into` FOREIGN KEY (`merged_into_customer_id`) REFERENCES `customers` (`customer_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_customers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_customers_not_merged_into_self` CHECK (((`merged_into_customer_id` is null) or (`merged_into_customer_id` <> `customer_id`))),
  CONSTRAINT `chk_customers_type_consistency` CHECK ((((`customer_type` = _utf8mb4'GUEST') and (`user_id` is null) and (`merged_into_customer_id` is null)) or ((`customer_type` = _utf8mb4'REGISTERED') and (`user_id` is not null) and (`merged_into_customer_id` is null)) or ((`customer_type` = _utf8mb4'MERGED') and (`merged_into_customer_id` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_roles` (
  `user_id` char(36) NOT NULL,
  `role_id` char(36) NOT NULL,
  `assigned_by` char(36) DEFAULT NULL,
  `assigned_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `idx_user_roles_role_id` (`role_id`),
  KEY `idx_user_roles_assigned_by` (`assigned_by`),
  CONSTRAINT `fk_user_roles_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT `fk_user_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`role_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_user_roles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `permissions` (
  `permission_id` char(36) NOT NULL,
  `permission_code` varchar(100) NOT NULL,
  `permission_name` varchar(150) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`permission_id`),
  UNIQUE KEY `uq_permissions_code` (`permission_code`),
  UNIQUE KEY `uq_permissions_name` (`permission_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `role_permissions` (
  `role_id` char(36) NOT NULL,
  `permission_id` char(36) NOT NULL,
  `assigned_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`role_id`,`permission_id`),
  KEY `idx_role_permissions_permission_id` (`permission_id`),
  CONSTRAINT `fk_role_permissions_permission` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`permission_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_role_permissions_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`role_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `refresh_token_sessions` (
  `session_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `token_family_id` char(36) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `replaced_by_token_id` char(36) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_used_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`session_id`),
  UNIQUE KEY `uq_refresh_token_hash` (`token_hash`),
  KEY `idx_refresh_user` (`user_id`,`created_at`),
  KEY `idx_refresh_family` (`token_family_id`,`revoked_at`),
  KEY `idx_refresh_expiry` (`expires_at`),
  KEY `idx_refresh_replaced_by` (`replaced_by_token_id`),
  CONSTRAINT `fk_refresh_sessions_replaced_by` FOREIGN KEY (`replaced_by_token_id`) REFERENCES `refresh_token_sessions` (`session_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_refresh_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_refresh_token_expiry` CHECK ((`expires_at` > `created_at`)),
  CONSTRAINT `chk_refresh_token_not_self_replaced` CHECK (((`replaced_by_token_id` is null) or (`replaced_by_token_id` <> `session_id`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_audit_logs` (
  `audit_id` char(36) NOT NULL,
  `actor_user_id` char(36) DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `resource_type` varchar(100) NOT NULL,
  `resource_id` varchar(100) DEFAULT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`audit_id`),
  KEY `idx_user_audit_actor_created` (`actor_user_id`,`created_at`),
  KEY `idx_user_audit_resource_created` (`resource_type`,`resource_id`,`created_at`),
  KEY `idx_user_audit_created` (`created_at`),
  CONSTRAINT `fk_user_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `customer_merge_history` (
  `merge_history_id` char(36) NOT NULL,
  `source_customer_id` char(36) NOT NULL,
  `target_customer_id` char(36) NOT NULL,
  `target_user_id` char(36) NOT NULL,
  `verified_by_user_id` char(36) NOT NULL,
  `verification_reference` varchar(500) NOT NULL,
  `merge_reason` varchar(500) DEFAULT NULL,
  `merged_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`merge_history_id`),
  KEY `fk_merge_target_user` (`target_user_id`),
  KEY `idx_merge_source_customer` (`source_customer_id`,`merged_at`),
  KEY `idx_merge_target_customer` (`target_customer_id`,`merged_at`),
  KEY `idx_merge_verified_by` (`verified_by_user_id`,`merged_at`),
  CONSTRAINT `fk_merge_source_customer` FOREIGN KEY (`source_customer_id`) REFERENCES `customers` (`customer_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_merge_target_customer` FOREIGN KEY (`target_customer_id`) REFERENCES `customers` (`customer_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_merge_target_user` FOREIGN KEY (`target_user_id`) REFERENCES `users` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_merge_verified_by` FOREIGN KEY (`verified_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_merge_source_not_target` CHECK ((`source_customer_id` <> `target_customer_id`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `internal_token_replays` (
  `internal_token_replay_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `issuer` varchar(255) NOT NULL,
  `jti` varchar(128) NOT NULL,
  `client_id` varchar(64) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`internal_token_replay_id`),
  UNIQUE KEY `internal_token_replays_issuer_jti_unique` (`issuer`,`jti`),
  KEY `internal_token_replays_expires_at_index` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
